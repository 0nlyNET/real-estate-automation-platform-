import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { isPlatformAdminEmail, requireJwtSecret, resolvePlatformRole } from '../../common/env';
import { UsersService } from '../users/users.service';
import type { Request } from 'express';
import { readCookie, SESSION_COOKIE } from './session-cookie';
import { JWT_VERIFY_OPTIONS } from './auth-token';

type JwtPayload = {
  sub?: string;
  exp?: number;
  impersonatedBy?: {
    userId?: string;
    email?: string;
  };
  operatorMode?: {
    tenantId?: string;
    tenantName?: string;
    startedByUserId?: string;
    startedByEmail?: string;
    startedAt?: string;
  };
  sessionVersion?: number;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private readonly logger = new Logger(JwtStrategy.name);
  constructor(private readonly users: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => readCookie(request, SESSION_COOKIE),
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(),
      ...JWT_VERIFY_OPTIONS,
    });
  }

  async validate(payload: JwtPayload) {
    const start = Date.now();
    const requestId = Math.random().toString(36).substring(7);
    this.logger.log(`[${requestId}] JWT validate start - sub: ${payload?.sub}`);
    
    if (!payload?.sub) throw new UnauthorizedException('Invalid session');

    const userStart = Date.now();
    const user = await this.users.findById(payload.sub);
    const userDuration = Date.now() - userStart;
    this.logger.log(`[${requestId}] users.findById took ${userDuration}ms`);
    
    if (!user || !user.isActive || !user.isEmailVerified || !user.tenantId) {
      throw new UnauthorizedException('Account is inactive or session is invalid');
    }
    if (payload.sessionVersion !== user.sessionVersion || user.mustChangePassword) {
      throw new UnauthorizedException('Session has been revoked');
    }

    let impersonatedBy:
      | { userId: string; email: string }
      | undefined;
    if (payload.impersonatedBy) {
      const actorId = String(payload.impersonatedBy.userId || '').trim();
      const actor = actorId ? await this.users.findById(actorId) : null;
      if (
        !actor ||
        !actor.isActive ||
        !actor.isEmailVerified ||
        !isPlatformAdminEmail(actor.email)
      ) {
        throw new UnauthorizedException('Support session is no longer authorized');
      }
      impersonatedBy = { userId: actor.id, email: actor.email };
    }

    // Use current database state so deactivation, role, tenant, and admin changes
    // take effect immediately instead of remaining stale for the JWT lifetime.
    const platformRole = impersonatedBy
      ? null
      : resolvePlatformRole(user.email, user.platformRole);

    // Explicit tenant-scoped operator session: the operator keeps their own
    // identity, but the effective tenant is the one they explicitly selected in
    // Admin. The actor must still be an active, verified platform admin —
    // otherwise the operator session is rejected. The tenantId comes from the
    // signed payload (created server-side by POST /admin/operator-mode), never
    // from client-supplied request parameters.
    let operatorMode:
      | {
          tenantId: string;
          tenantName: string;
          startedByUserId: string;
          startedByEmail: string;
          startedAt: string;
        }
      | undefined;
    let effectiveTenantId = user.tenantId;
    if (payload.operatorMode?.tenantId) {
      if (!isPlatformAdminEmail(user.email)) {
        throw new UnauthorizedException('Operator session is no longer authorized');
      }
      const operatorTenantId = String(payload.operatorMode.tenantId).trim();
      if (!operatorTenantId) {
        throw new UnauthorizedException('Operator session has no tenant context');
      }
      effectiveTenantId = operatorTenantId;
      operatorMode = {
        tenantId: operatorTenantId,
        tenantName: String(payload.operatorMode.tenantName || '').trim(),
        startedByUserId: String(payload.operatorMode.startedByUserId || user.id),
        startedByEmail: String(payload.operatorMode.startedByEmail || user.email),
        startedAt: String(payload.operatorMode.startedAt || ''),
      };
    }

    const total = Date.now() - start;
    this.logger.log(`[${requestId}] JWT validate complete - total ${total}ms`);

    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: effectiveTenantId,
      platformAdmin: impersonatedBy ? false : isPlatformAdminEmail(user.email),
      platformRole,
      platformOperator: platformRole !== null,
      ...(impersonatedBy ? { impersonatedBy } : {}),
      ...(operatorMode ? { operatorMode } : {}),
      sessionExpiresAt: payload.exp
        ? new Date(payload.exp * 1000).toISOString()
        : null,
    };
  }
}
