import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { isPlatformAdminEmail, requireJwtSecret } from '../../common/env';
import { UsersService } from '../users/users.service';

type JwtPayload = {
  sub?: string;
  exp?: number;
  impersonatedBy?: {
    userId?: string;
    email?: string;
  };
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly users: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(),
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload?.sub) throw new UnauthorizedException('Invalid session');

    const user = await this.users.findById(payload.sub);
    if (!user || !user.isActive || !user.isEmailVerified || !user.tenantId) {
      throw new UnauthorizedException('Account is inactive or session is invalid');
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
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      platformAdmin: impersonatedBy ? false : isPlatformAdminEmail(user.email),
      ...(impersonatedBy ? { impersonatedBy } : {}),
      sessionExpiresAt: payload.exp
        ? new Date(payload.exp * 1000).toISOString()
        : null,
    };
  }
}
