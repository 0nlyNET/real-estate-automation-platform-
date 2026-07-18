import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { isPlatformAdminEmail, requireJwtSecret } from '../../common/env';
import { UsersService } from '../users/users.service';

type JwtPayload = {
  sub?: string;
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

    // Use current database state so deactivation, role, tenant, and admin changes
    // take effect immediately instead of remaining stale for the JWT lifetime.
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      platformAdmin: isPlatformAdminEmail(user.email),
    };
  }
}
