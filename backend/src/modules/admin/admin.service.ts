import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { Credential } from '../settings/credential.entity';
import { MailService } from '../../mail/mail.service';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { OnboardingRecord } from '../onboarding/onboarding-record.entity';
import { OperationsService } from '../operations/operations.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(Tenant) private readonly tenantsRepo: Repository<Tenant>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(Message)
    private readonly messagesRepo: Repository<Message>,
    @InjectRepository(Credential)
    private readonly credentialsRepo: Repository<Credential>,
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
    @Optional() private readonly operations?: OperationsService,
  ) {}

  async createClient(params: { businessName: string; ownerEmail: string }) {
    const businessName = String(params.businessName || '').trim();
    const ownerEmail = String(params.ownerEmail || '')
      .trim()
      .toLowerCase();
    const temporaryPassword = `Temp-${crypto.randomBytes(18).toString('base64url')}`;
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenHash = crypto
      .createHash('sha256')
      .update(verificationToken)
      .digest('hex');

    const created = await this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(User);
      const existing = await users.findOne({ where: { email: ownerEmail } });
      if (existing)
        throw new BadRequestException('Owner email is already in use');

      const tenants = manager.getRepository(Tenant);
      const tenant = await tenants.save(
        tenants.create({
          name: businessName,
          plan: 'trial',
          status: 'incomplete',
          lifecycleStatus: 'ONBOARDING',
          billingInterval: 'month',
          trialEndsAt: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          cancelAt: null,
        }),
      );

      const owner = await users.save(
        users.create({
          tenantId: tenant.id,
          tenant,
          email: ownerEmail,
          passwordHash: await bcrypt.hash(temporaryPassword, 12),
          role: 'owner',
          teamId: null,
          isEmailVerified: false,
          emailVerifyToken: verificationTokenHash,
          emailVerifyTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          isActive: true,
          mustChangePassword: true,
        }),
      );

      const tenantSettings = manager.getRepository(TenantSettings);
      await tenantSettings.save(
        tenantSettings.create({ tenantId: tenant.id, automationsEnabled: false }),
      );
      const onboarding = manager.getRepository(OnboardingRecord);
      await onboarding.save(
        onboarding.create({
          tenantId: tenant.id,
          businessIdentity: { legalBusinessName: businessName },
          contacts: { accountOwner: ownerEmail },
          serviceScope: {},
          leadHandling: {},
          brandCommunication: {},
          consentConfiguration: {},
          integrationConfiguration: {},
          providerTests: {},
          verifiedItems: {},
          smsEnabled: false,
          emailEnabled: false,
          bookingEnabled: false,
          activationStatus: 'incomplete',
        }),
      );

      return { tenant, owner };
    });

    const frontend = (
      process.env.FRONTEND_URL || 'http://localhost:3000'
    ).replace(/\/+$/, '');
    const verifyLink = `${frontend}/verify-email?token=${verificationToken}`;
    let verificationEmailSent = false;
    try {
      await this.mail.sendVerificationEmail({ to: ownerEmail, verifyLink });
      verificationEmailSent = true;
    } catch (error: unknown) {
      this.logger.warn(
        `Client created but verification email was not delivered: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.operations?.createTask({
        tenantId: created.tenant.id,
        category: 'notification_failure',
        title: 'Client verification email failed',
        description: 'Resend the verification email after system email configuration is restored.',
        priority: 'high',
        relatedEntityType: 'user',
        relatedEntityId: created.owner.id,
        dedupeOpen: true,
      });
    }

    await this.operations?.createTask({
      tenantId: created.tenant.id,
      category: 'onboarding_task',
      title: 'Complete paid-pilot onboarding',
      description: 'Assign an owner, collect client intake, connect required providers, run UAT, and record launch approvals.',
      priority: 'high',
      relatedEntityType: 'tenant',
      relatedEntityId: created.tenant.id,
      dedupeOpen: true,
    });

    return {
      tenant: {
        id: created.tenant.id,
        name: created.tenant.name,
        plan: created.tenant.plan,
        status: created.tenant.status,
        trialEndsAt: created.tenant.trialEndsAt,
      },
      owner: {
        id: created.owner.id,
        email: created.owner.email,
        role: created.owner.role,
        isEmailVerified: created.owner.isEmailVerified,
      },
      temporaryPassword,
      verifyLink,
      verificationEmailSent,
    };
  }

  async listTenants(): Promise<Tenant[]> {
    return this.tenantsRepo.find({ order: { createdAt: 'DESC' as any } });
  }

  async listUsersByTenant(tenantId: string): Promise<User[]> {
    return this.usersRepo.find({
      where: { tenantId } as any,
      order: { email: 'ASC' as any },
    });
  }

  async findUserById(id: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { id } as any });
  }

  async overview() {
    const tenants = await this.tenantsRepo.find();

    const totalClients = tenants.length;
    const active = tenants.filter(
      (t: any) => String(t.status).toLowerCase() === 'active',
    ).length;
    const trialing = tenants.filter(
      (t: any) => String(t.status).toLowerCase() === 'trialing',
    ).length;
    const pastDue = tenants.filter(
      (t: any) => String(t.status).toLowerCase() === 'past_due',
    ).length;
    const canceled = tenants.filter(
      (t: any) => String(t.status).toLowerCase() === 'canceled',
    ).length;

    return { totalClients, active, trialing, pastDue, canceled };
  }

  async systemHealth() {
    const now = Date.now();
    const sinceMs = now - 24 * 60 * 60 * 1000;
    const since = new Date(sinceMs);

    // These fields may differ in your Message entity. We handle common cases safely.
    const totalMessages24h = await this.messagesRepo
      .createQueryBuilder('m')
      .where('m.createdAt >= :since', { since })
      .getCount();

    const failedMessages24h = await this.messagesRepo
      .createQueryBuilder('m')
      .where('m.createdAt >= :since', { since })
      .andWhere('m.status = :failed', { failed: 'failed' })
      .getCount();

    return {
      totalMessages24h,
      failedMessages24h,
      dbConnected: true,
    };
  }
}
