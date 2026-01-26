import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';
import { UserRole } from '../../common/rbac';

export type JwtPayload = {
  sub: string;
  tenantId: string;
  email: string;
  role?: UserRole;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`${name} is missing. Set it in backend/.env`);
  }
  return v;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly users: UsersService,
    private readonly tenants: TenantsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireEnv('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.users.findById(payload.sub);
    const tenantId = payload.tenantId || user?.tenant?.id;
    const tenant = tenantId ? await this.tenants.findById(tenantId) : null;

    return {
      userId: payload.sub,
      tenantId,
      email: payload.email,
      role: (payload.role as any) || (user?.role as any) || 'read_only',
      teamId: (user as any)?.teamId || null,
      plan: tenant?.plan || 'trial',
    };
  }
}
