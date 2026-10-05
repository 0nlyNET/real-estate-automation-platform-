import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { isPlatformAdminEmail, requireJwtSecret, resolvePlatformRole } from '../../common/env';
import { requestIdOf } from '../../common/request-diagnostics';
import { UsersService } from '../users/users.service';
import type { User } from '../users/user.entity';
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
      // Pass the HTTP request through so every timing log shares the one
      // request ID assigned by the HTTP middleware (req.correlationId).
      passReqToCallback: true,
      ...JWT_VERIFY_OPTIONS,
    });
  }

  // Diagnostic instrumentation (temporary): one shared request ID across
  // auth -> user lookup -> /me -> tenant lookup, with elapsed time and
  // outcome recorded on success, denial, and error paths. Logs user id and
  // tenant id only — never user email.
  //
  // The first parameter accepts either the express request (passport-jwt with
  // passReqToCallback) or the payload directly (existing unit tests).
  async validate(requestOrPayload: any, maybePayload?: JwtPayload) {
    const payload: JwtPayload =
      maybePayload !== undefined ? maybePayload : (requestOrPayload as unknown as JwtPayload);
    const requestId = maybePayload !== undefined ? requestIdOf(requestOrPayload) : 'no-request-id';
    const start = Date.now();
    const sub = payload?.sub;
    this.logger.log(`[diag][${requestId}] jwt validate start sub=${sub || 'none'}`);

    if (!sub) {
      this.logger.warn(
        `[diag][${requestId}] jwt validate outcome=denied reason=Invalid session elapsedMs=${Date.now() - start}`,
      );
      throw new UnauthorizedException('Invalid session');
    }

    let user: User | null;
    try {
      user = await this.users.findById(sub as string, requestId);
    } catch (error) {
      this.logger.error(
        `[diag][${requestId}] jwt validate outcome=error step=users.findById elapsedMs=${Date.now() - start} error=${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }

    if (!user || !user.isActive || !user.isEmailVerified || !user.tenantId) {
      this.logger.warn(
        `[diag][${requestId}] jwt validate outcome=denied reason=Account is inactive or session is invalid elapsedMs=${Date.now() - start}`,
      );
      throw new UnauthorizedException('Account is inactive or session is invalid');
    }
    if (payload.sessionVersion !== user.sessionVersion || user.mustChangePassword) {
      this.logger.warn(
        `[diag][${requestId}] jwt validate outcome=denied reason=Session has been revoked elapsedMs=${Date.now() - start}`,
      );
      throw new UnauthorizedException('Session has been revoked');
    }

    let impersonatedBy:
      | { userId: string; email: string }
      | undefined;
    if (payload.impersonatedBy) {
      const actorId = String(payload.impersonatedBy.userId || '').trim();
      let actor: User | null = null;
      try {
        actor = actorId ? await this.users.findById(actorId, requestId) : null;
      } catch (error) {
        this.logger.error(
          `[diag][${requestId}] jwt validate outcome=error step=actor.findById elapsedMs=${Date.now() - start} error=${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
      if (
        !actor ||
        !actor.isActive ||
        !actor.isEmailVerified ||
        !isPlatformAdminEmail(actor.email)
      ) {
      this.logger.warn(
        `[diag][${requestId}] jwt validate outcome=denied reason=Support session is no longer authorized elapsedMs=${Date.now() - start}`,
      );
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
      this.logger.warn(
        `[diag][${requestId}] jwt validate outcome=denied reason=Operator session is no longer authorized elapsedMs=${Date.now() - start}`,
      );
      throw new UnauthorizedException('Operator session is no longer authorized');
    }
      const operatorTenantId = String(payload.operatorMode.tenantId).trim();
      if (!operatorTenantId) {
      this.logger.warn(
        `[diag][${requestId}] jwt validate outcome=denied reason=Operator session has no tenant context elapsedMs=${Date.now() - start}`,
      );
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
    this.logger.log(
      `[diag][${requestId}] jwt validate complete outcome=authenticated elapsedMs=${total} userId=${user.id} tenantId=${effectiveTenantId}`,
    );

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
