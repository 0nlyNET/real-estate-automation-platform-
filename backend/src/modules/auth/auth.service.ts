import { BadRequestException, ForbiddenException, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { DataSource, Repository } from 'typeorm';

import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { isPlatformAdminEmail, resolvePlatformRole } from '../../common/env';
import { MailService } from '../../mail/mail.service';
import { OperationsService } from '../operations/operations.service';
import { AccountInvitation } from './account-invitation.entity';
import { AuditService } from '../audit/audit.service';
import { operationalEvent } from '../../common/operational-log';

const STANDARD_SESSION_EXPIRES_IN = '12h' as const;
const REMEMBERED_SESSION_EXPIRES_IN = '30d' as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetRepo: Repository<PasswordResetToken>,
    private readonly mail: MailService,
    private readonly operations: OperationsService,
    @Optional()
    @InjectRepository(AccountInvitation)
    private readonly invitations?: Repository<AccountInvitation>,
    @Optional() private readonly dataSource?: DataSource,
    @Optional() private readonly audit?: AuditService,
  ) {}

  signForUser(user: User, rememberMe = false) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      platformAdmin: isPlatformAdminEmail(user.email),
      platformRole: resolvePlatformRole(user.email, user.platformRole),
      sessionVersion: user.sessionVersion,
    };
    return this.jwtService.sign(payload, {
      expiresIn: rememberMe ? REMEMBERED_SESSION_EXPIRES_IN : STANDARD_SESSION_EXPIRES_IN,
    });
  }

  signForImpersonation(
    user: User,
    actor: { id: string; email: string },
  ) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      platformAdmin: false,
      impersonatedBy: {
        userId: actor.id,
        email: actor.email,
      },
      sessionVersion: user.sessionVersion,
    };
    return this.jwtService.sign(payload, { expiresIn: '15m' });
  }

  async login(email: string, password: string, rememberMe = false) {
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

    if (user.mustChangePassword) {
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Change the temporary password before signing in.',
      });
    }

    user.lastLoginAt = new Date();
    await this.usersService.save(user);

    return {
      accessToken: this.signForUser(user, rememberMe),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        isPlatformAdmin: isPlatformAdminEmail(user.email),
        platformRole: resolvePlatformRole(user.email, user.platformRole),
      },
    };
  }

  async acceptInvitation(token: string, password: string) {
    if (!this.dataSource) throw new BadRequestException('Invitation service is unavailable');
    const rawToken = String(token || '').trim();
    if (!rawToken) throw new BadRequestException('Missing invitation token');
    if (String(password || '').length < 12) {
      throw new BadRequestException('Password must be at least 12 characters');
    }
    const tokenHash = hashToken(rawToken);
    const user = await this.dataSource.transaction(async (manager) => {
      const invitation = await manager
        .getRepository(AccountInvitation)
        .createQueryBuilder('invitation')
        .setLock('pessimistic_write')
        .leftJoinAndSelect('invitation.user', 'user')
        .where('invitation.token_hash = :tokenHash', { tokenHash })
        .getOne();
      if (!invitation || !invitation.user) {
        throw new BadRequestException('Invalid invitation');
      }
      if (invitation.usedAt || invitation.revokedAt) {
        throw new BadRequestException('Invitation already used or replaced');
      }
      if (invitation.expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('Invitation expired');
      }
      if (
        invitation.user.tenantId !== invitation.tenantId ||
        !invitation.user.isActive ||
        invitation.user.passwordHash
      ) {
        throw new BadRequestException('Invitation no longer applies to this account');
      }
      invitation.usedAt = new Date();
      const invitedUser = invitation.user;
      invitedUser.passwordHash = await bcrypt.hash(password, 12);
      invitedUser.isEmailVerified = true;
      invitedUser.emailVerifyToken = null;
      invitedUser.emailVerifyTokenExpiresAt = null;
      invitedUser.mustChangePassword = false;
      invitedUser.passwordChangedAt = new Date();
      invitedUser.sessionVersion += 1;
      await manager.getRepository(User).save(invitedUser);
      await manager.getRepository(AccountInvitation).save(invitation);
      return invitedUser;
    });

    await this.sendWelcomeEmail(user);
    await this.audit?.recordSystemEvent({
      tenantId: user.tenantId,
      eventType: 'account.invitation_accepted',
      resourceType: 'user',
      resourceId: user.id,
      afterState: { isEmailVerified: true, passwordConfigured: true },
    });
    return {
      accessToken: this.signForUser(user),
      user: this.publicUser(user),
    };
  }

  async resendInvitation(tenantId: string) {
    if (!this.invitations || !this.dataSource) {
      throw new BadRequestException('Invitation service is unavailable');
    }
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const result = await this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const owner = await users.findOne({
        where: { tenantId, role: 'owner' },
        order: { createdAt: 'ASC' },
      });
      if (!owner) throw new BadRequestException('Workspace owner not found');
      if (owner.passwordHash || owner.isEmailVerified) {
        throw new BadRequestException('Owner has already accepted the invitation');
      }
      await manager
        .getRepository(AccountInvitation)
        .createQueryBuilder()
        .update(AccountInvitation)
        .set({ revokedAt: new Date() })
        .where('tenant_id = :tenantId', { tenantId })
        .andWhere('user_id = :userId', { userId: owner.id })
        .andWhere('used_at IS NULL')
        .andWhere('revoked_at IS NULL')
        .execute();
      const invitation = await manager.getRepository(AccountInvitation).save(
        manager.getRepository(AccountInvitation).create({
          tenantId,
          userId: owner.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
          usedAt: null,
          revokedAt: null,
          sentAt: null,
        }),
      );
      return { owner, invitation };
    });
    const invitationLink = invitationUrl(rawToken);
    await this.mail.sendAccountInvitation({
      to: result.owner.email,
      invitationLink,
    });
    result.invitation.sentAt = new Date();
    await this.invitations.save(result.invitation);
    await this.audit?.recordSystemEvent({
      tenantId,
      eventType: 'account.invitation_resent',
      resourceType: 'account_invitation',
      resourceId: result.invitation.id,
      metadata: { ownerUserId: result.owner.id, expiresAt: result.invitation.expiresAt },
    });
    return {
      ok: true,
      ownerUserId: result.owner.id,
      expiresAt: result.invitation.expiresAt,
    };
  }

  async verifyEmail(token: string) {
    const user = await this.usersService.verifyEmail(token);
    await this.sendWelcomeEmail(user);
    return {
      ok: true,
      userId: user.id,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
    };
  }

  private async sendWelcomeEmail(user: User) {
    const claimedAt = await this.usersService.claimWelcomeEmail(user.id);
    if (!claimedAt) return;
    try {
      await this.mail.sendWelcomeEmail({ to: user.email });
    } catch (error: unknown) {
      await this.usersService
        .releaseWelcomeEmail(user.id, claimedAt)
        .catch(() => undefined);
      await this.operations
        .createTask({
          tenantId: user.tenantId,
          category: 'notification_failure',
          title: 'Welcome email failed',
          description: 'Retry the welcome and onboarding email after system mail is restored.',
          priority: 'normal',
          relatedEntityType: 'user',
          relatedEntityId: user.id,
          dedupeOpen: true,
        })
        .catch(() => undefined);
      this.logger.error(
        operationalEvent('welcome_email_failed', {
          userId: user.id,
          tenantId: user.tenantId,
          error:
            error instanceof Error
              ? error.message.slice(0, 500)
              : String(error).slice(0, 500),
        }),
      );
    }
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

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const persistReset = async (repository: Repository<PasswordResetToken>) => {
      // password_reset_tokens is a legacy mixed-case table: the relation column
      // is "userId", while lifecycle columns use snake_case. Raw property names
      // are not translated by an update query builder on PostgreSQL.
      await repository
        .createQueryBuilder()
        .update(PasswordResetToken)
        .set({ usedAt: new Date() })
        .where('"userId" = :userId', { userId: user.id })
        .andWhere('"used_at" IS NULL')
        .execute();

      return repository.save(
        repository.create({
          user,
          tokenHash,
          expiresAt,
        }),
      );
    };
    const reset = this.dataSource
      ? await this.dataSource.transaction((manager) =>
          persistReset(manager.getRepository(PasswordResetToken)),
        )
      : await persistReset(this.passwordResetRepo);

    const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetLink = `${frontend.replace(/\/+$/, '')}/reset-password?token=${rawToken}`;

    try {
      await this.mail.sendEmail({
        to: user.email,
        subject: 'Reset your RealtyTechAI password',
        text: `Reset your password using this link: ${resetLink}\n\nThis link expires in one hour.`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.5">
            <h2 style="margin:0 0 12px">Reset your RealtyTechAI password</h2>
            <p style="margin:0 0 16px">Use this single-use link within one hour.</p>
            <p style="margin:0 0 16px"><a href="${resetLink}" style="display:inline-block;padding:10px 14px;background:#111827;color:#fff;text-decoration:none;border-radius:6px">Reset password</a></p>
            <p style="margin:0;font-size:12px;color:#6b7280">If the button does not work, paste this link into your browser: ${resetLink}</p>
          </div>`,
      });
    } catch (error: unknown) {
      // Do not reveal whether an account exists through a different status or
      // response body. Invalidate the undelivered token and create an operator
      // task so a provider failure is never silently treated as success.
      await this.passwordResetRepo
        .update({ id: reset.id }, { usedAt: new Date() })
        .catch(() => undefined);
      await this.operations
        .createTask({
          tenantId: user.tenantId,
          category: 'notification_failure',
          title: 'Password reset email failed',
          description:
            'The reset token was invalidated because system email did not confirm acceptance. Restore system email and ask the user to request a new link.',
          priority: 'high',
          relatedEntityType: 'user',
          relatedEntityId: user.id,
          dedupeOpen: true,
        })
        .catch(() => undefined);
      this.logger.error(
        operationalEvent('password_reset_email_failed', {
          userId: user.id,
          tenantId: user.tenantId,
          error:
            error instanceof Error
              ? error.message.slice(0, 500)
              : String(error).slice(0, 500),
        }),
      );
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
    let changedUser: User;

    if (this.dataSource) {
      changedUser = await this.dataSource.transaction(async (manager) => {
        const resets = manager.getRepository(PasswordResetToken);
        const reset = await resets
          .createQueryBuilder('reset')
          .setLock('pessimistic_write')
          .leftJoinAndSelect('reset.user', 'user')
          .where('reset.token_hash = :tokenHash', { tokenHash })
          .getOne();
        this.validatePasswordReset(reset);

        const user = reset!.user;
        user.passwordHash = await bcrypt.hash(passwordClean, 12);
        user.mustChangePassword = false;
        user.passwordChangedAt = new Date();
        user.sessionVersion += 1;
        reset!.usedAt = new Date();
        await manager.getRepository(User).save(user);
        await resets.save(reset!);
        return user;
      });
    } else {
      const reset = await this.passwordResetRepo.findOne({
        where: { tokenHash },
        relations: ['user'],
      });
      this.validatePasswordReset(reset);

      const claim = await this.passwordResetRepo
        .createQueryBuilder()
        .update(PasswordResetToken)
        .set({ usedAt: new Date() })
        .where('id = :id', { id: reset!.id })
        .andWhere('"used_at" IS NULL')
        .andWhere('"expires_at" > :now', { now: new Date() })
        .execute();
      if (claim.affected !== 1)
        throw new BadRequestException('Token already used or expired');

      changedUser = reset!.user;
      changedUser.passwordHash = await bcrypt.hash(passwordClean, 12);
      changedUser.mustChangePassword = false;
      changedUser.passwordChangedAt = new Date();
      changedUser.sessionVersion += 1;
      await this.usersService.save(changedUser);
    }

    await this.audit?.recordSystemEvent({
      tenantId: changedUser.tenantId,
      eventType: 'account.password_reset',
      resourceType: 'user',
      resourceId: changedUser.id,
      afterState: { sessionVersion: changedUser.sessionVersion },
    });

    return {
      ok: true,
      message: 'Password updated successfully.',
    };
  }

  private validatePasswordReset(
    reset: PasswordResetToken | null | undefined,
  ): asserts reset is PasswordResetToken & { user: User } {
    if (!reset?.user) throw new BadRequestException('Invalid token');
    if (reset.usedAt) throw new BadRequestException('Token already used');
    if (reset.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Token expired');
    }
  }

  async changeTemporaryPassword(email: string, temporaryPassword: string, newPassword: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user?.passwordHash || !user.mustChangePassword) {
      throw new UnauthorizedException('Invalid temporary credentials');
    }
    if (!(await bcrypt.compare(temporaryPassword, user.passwordHash))) {
      throw new UnauthorizedException('Invalid temporary credentials');
    }
    if (newPassword.length < 12 || newPassword === temporaryPassword) {
      throw new BadRequestException('Choose a new password with at least 12 characters');
    }
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    user.sessionVersion += 1;
    await this.usersService.save(user);
    return { ok: true, message: 'Password changed. You can now sign in.' };
  }

  async revokeSession(userId: string) {
    const user = await this.usersService.findById(userId);
    if (user) {
      user.sessionVersion += 1;
      await this.usersService.save(user);
    }
    return { ok: true };
  }

  private publicUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      isPlatformAdmin: isPlatformAdminEmail(user.email),
      platformRole: resolvePlatformRole(user.email, user.platformRole),
    };
  }
}

export function hashToken(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function invitationUrl(rawToken: string) {
  const frontend = (
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_APP_URL ||
    'http://localhost:3000'
  ).replace(/\/+$/, '');
  return `${frontend}/accept-invitation?token=${encodeURIComponent(rawToken)}`;
}
