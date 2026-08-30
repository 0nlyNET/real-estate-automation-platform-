import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import { operationalEvent } from '../../common/operational-log';
import { managedServiceSeatLimit } from '../../common/plans';
import { MailService } from '../../mail/mail.service';
import { AccountInvitation } from '../auth/account-invitation.entity';
import { Team } from '../teams/team.entity';
import { Tenant } from '../tenants/tenant.entity';
import { User } from './user.entity';
import type { UserRole } from '../../common/rbac';

@Injectable()
export class TeamInvitationsService {
  private readonly logger = new Logger(TeamInvitationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
  ) {}

  async create(input: {
    tenant: Tenant;
    email: string;
    role: UserRole;
    teamId?: string | null;
  }) {
    const email = String(input.email || '').trim().toLowerCase();
    const rawToken = randomBytes(32).toString('base64url');
    const created = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `team-invitation:${input.tenant.id}`,
      ]);
      const users = manager.getRepository(User);
      if (await users.findOne({ where: { email } })) {
        throw new BadRequestException('Email already in use');
      }
      const activeCount = await users.count({
        where: { tenantId: input.tenant.id, isActive: true },
      });
      const limit = managedServiceSeatLimit();
      if (activeCount >= limit) {
        throw new BadRequestException(
          `Workspace seat limit reached (${limit}). Contact RealtyTechAI support to change the service scope.`,
        );
      }
      if (input.teamId) {
        const team = await manager.getRepository(Team).findOne({
          where: { id: input.teamId, tenantId: input.tenant.id },
        });
        if (!team) {
          throw new BadRequestException('Team must belong to this tenant');
        }
      }

      const user = await users.save(
        users.create({
          tenantId: input.tenant.id,
          tenant: input.tenant,
          email,
          passwordHash: null,
          role: input.role,
          teamId: input.teamId ?? null,
          team: null,
          isEmailVerified: false,
          emailVerifyToken: null,
          emailVerifyTokenExpiresAt: null,
          isActive: true,
          mustChangePassword: false,
          passwordChangedAt: null,
          sessionVersion: 0,
        }),
      );
      const invitations = manager.getRepository(AccountInvitation);
      const invitation = await invitations.save(
        invitations.create({
          tenantId: input.tenant.id,
          userId: user.id,
          tokenHash: createHash('sha256').update(rawToken).digest('hex'),
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
          usedAt: null,
          revokedAt: null,
          sentAt: null,
        }),
      );
      return { user, invitation };
    });

    const frontend = (
      process.env.FRONTEND_URL ||
      process.env.PUBLIC_APP_URL ||
      'http://localhost:3000'
    ).replace(/\/+$/, '');
    const invitationLink = `${frontend}/accept-invitation?token=${encodeURIComponent(rawToken)}`;
    try {
      await this.mail.sendAccountInvitation({
        to: created.user.email,
        invitationLink,
      });
    } catch (error: unknown) {
      // A token that was not confirmed as delivered must not remain active.
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(AccountInvitation).delete({
          id: created.invitation.id,
          tenantId: input.tenant.id,
          userId: created.user.id,
        });
        await manager.getRepository(User).delete({
          id: created.user.id,
          tenantId: input.tenant.id,
        });
      });
      this.logger.warn(
        operationalEvent('team_invitation_delivery_failed', {
          tenantId: input.tenant.id,
          userId: created.user.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw new ServiceUnavailableException(
        'Invitation email could not be delivered. Try again after email service is restored.',
      );
    }

    created.invitation.sentAt = new Date();
    await this.dataSource
      .getRepository(AccountInvitation)
      .save(created.invitation)
      .catch((error: unknown) => {
        this.logger.warn(
          operationalEvent('team_invitation_sent_timestamp_failed', {
            tenantId: input.tenant.id,
            userId: created.user.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });

    return {
      id: created.user.id,
      email: created.user.email,
      role: created.user.role,
      teamId: created.user.teamId,
      isActive: created.user.isActive,
      invitationEmailSent: true,
      invitationExpiresAt: created.invitation.expiresAt,
    };
  }
}
