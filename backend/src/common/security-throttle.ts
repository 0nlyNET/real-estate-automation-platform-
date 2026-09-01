import { createHash } from 'crypto';

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
