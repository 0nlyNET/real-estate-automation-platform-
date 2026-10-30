import { createHash } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { requireJwtSecret } from './env';
import { JWT_VERIFY_OPTIONS } from '../modules/auth/auth-token';
import { readCookie, SESSION_COOKIE } from '../modules/auth/session-cookie';

const sessionJwt = new JwtService();

const ACCOUNT_SCOPED_AUTH_PATHS = new Set([
  '/auth/login',
  '/auth/change-temporary-password',
  '/auth/forgot-password',
]);

function requestPath(request: Record<string, any>) {
  return String(request.path || request.originalUrl || '')
    .split('?', 1)[0]
    .replace(/\/+$/, '');
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Account-authentication endpoints are keyed by normalized account identity,
 * so rotating source IPs cannot bypass credential-stuffing protection. Other
 * anonymous requests remain keyed by the direct peer IP; forwarded headers are
 * deliberately ignored because the API can also be reached without a trusted
 * reverse proxy.
 */
export async function accountSecurityThrottleTracker(
  request: Record<string, any>,
): Promise<string> {
  const path = requestPath(request);
  if (ACCOUNT_SCOPED_AUTH_PATHS.has(path)) {
    const email =
      typeof request.body?.email === 'string'
        ? request.body.email.trim().toLowerCase().slice(0, 320)
        : '';
    if (email) return `account:${digest(email)}`;
  }

  const authenticatedUserId = String(request.user?.sub || '').trim();
  if (authenticatedUserId) {
    return `user:${digest(authenticatedUserId)}`;
  }

  return `ip:${String(request.ip || request.socket?.remoteAddress || 'unknown')}`;
}

export async function directIpThrottleTracker(
  request: Record<string, any>,
): Promise<string> {
  return `ip:${String(request.ip || request.socket?.remoteAddress || 'unknown')}`;
}

/**
 * Session checks arrive through the shared frontend peer. Keep the same limit
 * per signed subject so one user's navigation cannot block another user.
 * This only selects a throttle bucket: JwtStrategy still checks the current
 * database account, revocation, role and operator context before authorization.
 * Invalid/expired tokens and every other route retain the direct-peer bucket.
 */
export async function sessionSecurityThrottleTracker(request: Record<string, any>): Promise<string> {
  if (requestPath(request) === '/auth/session') {
    try {
      const token = readCookie(request as any, SESSION_COOKIE) ||
        String(request.headers?.authorization || '').match(/^Bearer\s+(\S+)$/i)?.[1];
      if (token) {
        const payload = sessionJwt.verify<Record<string, unknown>>(token, {
          secret: requireJwtSecret(), ...JWT_VERIFY_OPTIONS,
        });
        if (typeof payload.sub === 'string' && payload.sub.trim() &&
          typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
          return `session-user:${digest(payload.sub)}`;
        }
      }
    } catch {
      // Never trust decoded claims, forwarding headers or request.user here;
      // this global guard runs before the route authentication guard.
    }
  }
  return directIpThrottleTracker(request);
}
