import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly tenants: TenantsService,
    private readonly users: UsersService,
  ) {}

  async register(params: { email: string; password: string; brokerage?: string }) {
    const tenant = await this.tenants.createTrialTenant(params.brokerage || 'My Workspace');
    const { user, verifyToken } = await this.users.createUser({ email: params.email, password: params.password, tenant });

    const accessToken = await this.jwt.signAsync({ sub: user.id, tenantId: tenant.id, email: user.email, role: user.role });

    // Dev-friendly verify link (useful even if you don't have SendGrid wired yet)
    const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verifyLink = `${frontend.replace(/\/+$/, '')}/verify-email?token=${verifyToken}`;
    // eslint-disable-next-line no-console
    console.log(`[VERIFY_LINK] ${verifyLink}`);

    return { accessToken, verifyLink };
  }

  async login(params: { email: string; password: string }) {
    const user = await this.users.findByEmail(params.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await this.users.validatePassword(user, params.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const accessToken = await this.jwt.signAsync({ sub: user.id, tenantId: user.tenant.id, email: user.email, role: user.role });
    return { accessToken };
  }

  async verifyEmail(token: string) {
    const user = await this.users.verifyEmail(token);
    if (!user) throw new BadRequestException('Verification failed');
    return { ok: true };
  }

  /**
   * Password reset support.
   *
   * Your codebase already exposes controller routes that call these methods.
   * Some deployments may not have email delivery wired yet (SendGrid, etc.).
   *
   * To avoid breaking builds and to keep behavior safe:
   * - We return ok even when the email is unknown (prevents account enumeration).
   * - We do NOT change the password yet because the User entity in this repo
   *   does not currently store reset tokens.
   *
   * When you want full reset flow, we will add:
   * - users.passwordResetToken, users.passwordResetTokenExpiresAt
   * - email sending (or console link in dev)
   * - token validation + password update
   */
  async forgotPassword(email: string) {
    const e = (email || '').toLowerCase().trim();
    if (!e) throw new BadRequestException('Missing email');
    // Intentionally do not reveal whether the account exists.
    return { ok: true };
  }

  async resetPassword(_token: string, _password: string) {
    // See notes in forgotPassword().
    // This is a safe placeholder to satisfy existing controller expectations.
    throw new BadRequestException('Password reset is not enabled yet');
  }
}
