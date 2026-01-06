import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';
import { MailService } from '../../mail/mail.service';
import { PasswordResetToken } from './password-reset-token.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tenantsService: TenantsService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetRepo: Repository<PasswordResetToken>,
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

  
  private hashToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Always returns { ok: true } so attackers cannot enumerate accounts.
   * In development, you can set PASSWORD_RESET_ECHO_TOKEN=true to return the token for testing.
   */
  async requestPasswordReset(emailRaw: string) {
    const email = (emailRaw || '').trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');

    const user = await this.usersService.findByEmail(email);
    if (!user) return { ok: true };

    // Invalidate any old unused tokens
    await this.passwordResetRepo
      .createQueryBuilder()
      .update()
      .set({ usedAt: new Date() })
      .where('userId = :userId', { userId: (user as any).id })
      .andWhere('used_at IS NULL')
      .execute();

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 30) * 60_000);

    const row = this.passwordResetRepo.create({
      user: user as any,
      tokenHash,
      expiresAt,
    } as any);
    await this.passwordResetRepo.save(row);

    const appUrl =
      process.env.FRONTEND_URL ||
      process.env.PUBLIC_APP_URL ||
      'http://localhost:3000';

    const resetLink = `${appUrl.replace(/\/$/, '')}/reset-password?token=${token}`;

    const subject = 'Reset your password';
    const text =
      `You requested a password reset.\n\n` +
      `Reset link (expires in ${Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 30)} minutes):\n` +
      `${resetLink}\n\n` +
      `If you did not request this, you can ignore this email.`;

    try {
      await this.mailService.sendEmail({ to: email, subject, text });
    } catch (e: any) {
      // For early MVP environments without SendGrid configured, avoid breaking the flow.
      // The token can still be used if you enable PASSWORD_RESET_ECHO_TOKEN for testing.
    }

    const echo = process.env.PASSWORD_RESET_ECHO_TOKEN === 'true';
    return echo ? { ok: true, token, resetLink } : { ok: true };
  }

  async resetPassword(params: { token: string; newPassword: string }) {
    const token = (params.token || '').trim();
    const newPassword = (params.newPassword || '').trim();

    if (!token) throw new BadRequestException('Token is required');
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }

    const tokenHash = this.hashToken(token);

    const row = await this.passwordResetRepo.findOne({
      where: { tokenHash } as any,
      relations: ['user'],
    });

    if (!row) throw new BadRequestException('Invalid or expired token');
    if ((row as any).usedAt) throw new BadRequestException('Invalid or expired token');
    if (new Date((row as any).expiresAt).getTime() < Date.now()) {
      throw new BadRequestException('Invalid or expired token');
    }

    // Mark used first to avoid races
    (row as any).usedAt = new Date();
    await this.passwordResetRepo.save(row);

    await this.usersService.setPassword(row.user as any, newPassword);

    return { ok: true };
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
