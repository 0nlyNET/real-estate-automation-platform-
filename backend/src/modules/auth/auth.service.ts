import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tenantsService: TenantsService,
    private readonly jwtService: JwtService,
  ) {}

  async register(payload: { email: string; password: string; brokerage?: string }) {
    const email = payload.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');
    if (!payload.password || payload.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const existing = await this.usersService.findByEmail(email);
    if (existing) {
      throw new BadRequestException('Email already in use');
    }

    // Create a tenant if we have brokerage or can derive a reasonable slug from the email domain.
    const domain = email.split('@')[1] ?? '';
    const raw = (payload.brokerage?.trim() || domain || 'tenant').toLowerCase();
    const slug = raw
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'tenant';

    let tenant = await this.tenantsService.findBySlug(slug);
    if (!tenant) {
      tenant = await this.tenantsService.create({
        name: payload.brokerage?.trim() || slug,
        slug,
      });
    }

    const user = await this.usersService.createUser({
      email,
      password: payload.password,
      role: 'agent',
      tenantId: tenant.id,
    });

    const jwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    };
    return {
      accessToken: await this.jwtService.signAsync(jwtPayload),
    };
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await this.usersService.validatePassword(user, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const payload = { sub: user.id, email: user.email, role: user.role, tenantId: user.tenantId };
    return {
      accessToken: await this.jwtService.signAsync(payload),
    };
  }
}
