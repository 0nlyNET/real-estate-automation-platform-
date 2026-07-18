import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';

import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { isPlatformAdminEmail } from '../../common/env';
import { MailService } from '../../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetRepo: Repository<PasswordResetToken>,
    private readonly mail: MailService,
  ) {}

  signForUser(user: User) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      platformAdmin: isPlatformAdminEmail(user.email),
    };
    return this.jwtService.sign(payload);
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive || !user.isEmailVerified) {
      throw new UnauthorizedException('Account is inactive or email is unverified');
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      accessToken: this.signForUser(user),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        isPlatformAdmin: isPlatformAdminEmail(user.email),
      },
    };
  }

  async verifyEmail(token: string) {
    const user = await this.usersService.verifyEmail(token);
    return {
      ok: true,
      userId: user.id,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
    };
  }

  async requestPasswordReset(email: string) {
    const emailClean = String(email || '').toLowerCase().trim();

    if (!emailClean) {
      return {
        ok: true,
        message: 'If that email exists, a reset link has been created.',
      };
    }

    const user = await this.usersService.findByEmail(emailClean);

    if (!user) {
      return {
        ok: true,
        message: 'If that email exists, a reset link has been created.',
      };
    }

    await this.passwordResetRepo
      .createQueryBuilder()
      .update(PasswordResetToken)
      .set({ usedAt: new Date() })
      .where('userId = :userId', { userId: user.id })
      .andWhere('usedAt IS NULL')
      .execute();

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const reset = this.passwordResetRepo.create({
      user,
      tokenHash,
      expiresAt,
    });

    await this.passwordResetRepo.save(reset);

    const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetLink = `${frontend.replace(/\/+$/, '')}/reset-password?token=${rawToken}`;

    try {
      await this.mail.sendEmail({
        to: user.email,
        subject: 'Reset your RealtyTechAI password',
        text: `Reset your password using this link: ${resetLink}\n\nThis link expires in one hour.`,
      });
    } catch {
      if (process.env.NODE_ENV === 'production') {
        throw new BadRequestException('Password reset email could not be delivered');
      }
    }

    return {
      ok: true,
      message: 'If that email exists, a reset link has been created.',
      ...(process.env.NODE_ENV === 'production' ? {} : { resetLink }),
    };
  }

  async resetPassword(token: string, password: string) {
    const rawToken = String(token || '').trim();
    const passwordClean = String(password || '');

    if (!rawToken) {
      throw new BadRequestException('Missing token');
    }

    if (passwordClean.length < 12) {
      throw new BadRequestException('Password must be at least 12 characters');
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const reset = await this.passwordResetRepo.findOne({
      where: { tokenHash },
      relations: ['user'],
    });

    if (!reset) {
      throw new BadRequestException('Invalid token');
    }

    if (reset.usedAt) {
      throw new BadRequestException('Token already used');
    }

    if (reset.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Token expired');
    }

    const user = reset.user;
    if (!user) {
      throw new BadRequestException('Invalid token');
    }

    const claim = await this.passwordResetRepo
      .createQueryBuilder()
      .update(PasswordResetToken)
      .set({ usedAt: new Date() })
      .where('id = :id', { id: reset.id })
      .andWhere('usedAt IS NULL')
      .andWhere('expiresAt > :now', { now: new Date() })
      .execute();
    if (claim.affected !== 1) throw new BadRequestException('Token already used or expired');

    user.passwordHash = await bcrypt.hash(passwordClean, 12);
    await this.usersService.save(user);

    return {
      ok: true,
      message: 'Password updated successfully.',
    };
  }
}
