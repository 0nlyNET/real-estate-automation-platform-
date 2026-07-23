import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, MoreThanOrEqual, Repository } from 'typeorm';
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
import { ProspectApplication } from '../public/prospect-application.entity';
import { OperationsTask } from '../operations/operations-task.entity';
import { SupportTicket } from '../support/support-ticket.entity';
import { BillingEvent } from '../billing/billing-event.entity';
import { PlatformOperatorsService } from '../../common/platform-operators.service';
import { NotificationsService } from '../notifications/notifications.service';
import { environmentReadiness } from '../../common/environment-readiness';
import { decryptIntegrationPayload } from '../integrations/integrations.service';
import {
  isPlatformAdminEmail,
  platformAdminEmails,
  platformStaffEmails,
  resolvePlatformRole,
} from '../../common/env';

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
    @Optional()
    @InjectRepository(ProspectApplication)
    private readonly applicationsRepo?: Repository<ProspectApplication>,
    @Optional()
    @InjectRepository(OperationsTask)
    private readonly operationsRepo?: Repository<OperationsTask>,
    @Optional()
    @InjectRepository(SupportTicket)
    private readonly supportRepo?: Repository<SupportTicket>,
    @Optional()
    @InjectRepository(BillingEvent)
    private readonly billingEventsRepo?: Repository<BillingEvent>,
    @Optional() private readonly platformOperators?: PlatformOperatorsService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private async internalTenantIds() {
    const emails = [...platformAdminEmails()];
    if (!emails.length) return new Set<string>();
    const users = await this.usersRepo.find({
      select: { tenantId: true },
      where: { email: In(emails) },
    });
    return new Set(users.map((user) => user.tenantId).filter(Boolean));
  }

  async createClient(params: {
    businessName: string;
    ownerEmail: string;
    assignedOperatorId?: string | null;
  }) {
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
    if (params.assignedOperatorId) {
      await this.platformOperators?.requireAssignable(params.assignedOperatorId);
    }

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
          assignedOperatorId: params.assignedOperatorId || null,
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
    await this.notifications?.createForPlatform({
      eventType: 'client.created',
      category: 'clients',
      severity: 'success',
      title: 'New client workspace created',
      message: `${businessName} is ready for client intake and connection setup.`,
      deduplicationKey: `client:${created.tenant.id}`,
      actionUrl: '/admin/dashboard?view=clients',
      entityType: 'tenant',
      entityId: created.tenant.id,
    });

    return {
      tenant: {
        id: created.tenant.id,
        name: created.tenant.name,
        plan: created.tenant.plan,
        status: created.tenant.status,
        lifecycleStatus: created.tenant.lifecycleStatus,
        assignedOperatorId: created.tenant.assignedOperatorId || null,
        trialEndsAt: created.tenant.trialEndsAt,
        createdAt: created.tenant.createdAt,
        updatedAt: created.tenant.updatedAt,
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
    const [tenants, internalIds] = await Promise.all([
      this.tenantsRepo.find({ order: { createdAt: 'DESC' as any } }),
      this.internalTenantIds(),
    ]);
    return tenants.filter((tenant) => !internalIds.has(tenant.id));
  }

  async leadAttention(take = 50) {
    const limit = Math.min(Math.max(take || 50, 1), 100);
    const [rows, internalIds] = await Promise.all([
      this.leadsRepo
        .createQueryBuilder('lead')
        .innerJoinAndSelect('lead.tenant', 'tenant')
        .where('lead.stage NOT IN (:...finished)', {
          finished: ['closed', 'lost'],
        })
        .andWhere(
          '(lead.stage = :newStage OR lead.temperature = :hot OR lead.readinessLevel = :urgent)',
          { newStage: 'new', hot: 'hot', urgent: 'urgent' },
        )
        .orderBy('lead.createdAt', 'DESC')
        .take(limit)
        .getMany(),
      this.internalTenantIds(),
    ]);
    return rows
      .filter((lead) => !internalIds.has(lead.tenantId))
      .sort((a, b) => {
        const priority = (lead: Lead) =>
          lead.readinessLevel === 'urgent' ? 3 : lead.temperature === 'hot' ? 2 : 1;
        return priority(b) - priority(a) || b.createdAt.getTime() - a.createdAt.getTime();
      })
      .map((lead) => ({
        id: lead.id,
        fullName: lead.fullName,
        stage: lead.stage,
        temperature: lead.temperature,
        readinessLevel: lead.readinessLevel,
        recommendedNextAction: lead.recommendedNextAction || null,
        createdAt: lead.createdAt,
        tenant: {
          id: lead.tenantId,
          name: lead.tenant?.name || 'Client workspace',
        },
      }));
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

  listOperators() {
    return this.platformOperators?.listActive() || [];
  }

  async assignClient(tenantId: string, assignedOperatorId?: string | null) {
    await this.platformOperators?.requireAssignable(assignedOperatorId);
    const tenant = await this.tenantsRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('Client workspace not found');
    if ((await this.internalTenantIds()).has(tenant.id)) {
      throw new BadRequestException('The internal platform workspace is not a client');
    }
    tenant.assignedOperatorId = assignedOperatorId || null;
    const saved = await this.tenantsRepo.save(tenant);
    if (assignedOperatorId) {
      await this.notifications?.createForPlatform({
        eventType: 'client.assigned',
        category: 'clients',
        severity: 'info',
        title: 'Client assigned to you',
        message: `${saved.name || 'A client workspace'} is ready for your follow-up.`,
        deduplicationKey: `client-assigned:${saved.id}:${assignedOperatorId}`,
        assignedOperatorId,
        actionUrl: '/admin/dashboard?view=clients',
        entityType: 'tenant',
        entityId: saved.id,
      });
    }
    return saved;
  }

  async platformAccessUsers(tenantId: string) {
    const users = await this.usersRepo.find({
      where: { tenantId },
      order: { email: 'ASC' },
    });
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      isEmailVerified: user.isEmailVerified,
      platformRole: resolvePlatformRole(user.email, user.platformRole),
      accessManagedByEnvironment:
        isPlatformAdminEmail(user.email) || platformStaffEmails().has(user.email.toLowerCase()),
    }));
  }

  async setPlatformStaff(
    tenantId: string,
    userId: string,
    enabled: boolean,
  ) {
    const user = await this.usersRepo.findOne({ where: { id: userId, tenantId } });
    if (!user) throw new BadRequestException('Platform workspace user not found');
    if (isPlatformAdminEmail(user.email)) {
      throw new BadRequestException('Environment SuperAdmin access cannot be changed here');
    }
    if (platformStaffEmails().has(user.email.toLowerCase())) {
      throw new BadRequestException('Environment Staff access cannot be changed here');
    }
    if (enabled && (!user.isActive || !user.isEmailVerified)) {
      throw new BadRequestException('Staff access requires an active, verified user');
    }
    if (enabled) {
      user.platformRole = 'staff';
      await this.usersRepo.save(user);
    } else {
      await this.dataSource.transaction(async (manager) => {
        user.platformRole = null;
        await manager.getRepository(User).save(user);
        await manager.getRepository(Tenant).update(
          { assignedOperatorId: user.id },
          { assignedOperatorId: null },
        );
        await manager.getRepository(ProspectApplication).update(
          { assignedOperatorId: user.id },
          { assignedOperatorId: null },
        );
        await manager.getRepository(OperationsTask).update(
          { assignedOperatorId: user.id },
          { assignedOperatorId: null },
        );
        await manager.getRepository(SupportTicket).update(
          { assignedOperatorId: user.id },
          { assignedOperatorId: null },
        );
        await manager.getRepository(OnboardingRecord).update(
          { assignedOnboardingOwnerId: user.id },
          { assignedOnboardingOwnerId: null },
        );
      });
    }
    return {
      id: user.id,
      email: user.email,
      isActive: user.isActive,
      isEmailVerified: user.isEmailVerified,
      platformRole: resolvePlatformRole(user.email, user.platformRole),
      accessManagedByEnvironment: false,
    };
  }

  async overview(includeRestricted = false) {
    const tenants = await this.listTenants();

    const totalClients = tenants.length;
    const active = tenants.filter(
      (tenant) => tenant.lifecycleStatus === 'ACTIVE',
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

    const [newApplications, openTasks, urgentTasks, openSupport] = await Promise.all([
      this.applicationsRepo?.count({ where: { status: 'new' } }) || 0,
      this.operationsRepo
        ?.createQueryBuilder('task')
        .where('task.status != :resolved', { resolved: 'resolved' })
        .getCount() || 0,
      this.operationsRepo
        ?.createQueryBuilder('task')
        .where('task.status != :resolved', { resolved: 'resolved' })
        .andWhere('task.priority IN (:...priorities)', { priorities: ['high', 'critical'] })
        .getCount() || 0,
      this.supportRepo
        ?.createQueryBuilder('ticket')
        .where('ticket.status IN (:...statuses)', { statuses: ['open', 'acknowledged'] })
        .getCount() || 0,
    ]);
    const onboarding = tenants.filter((tenant) =>
      ['DRAFT', 'ONBOARDING', 'READY_FOR_UAT', 'UAT_FAILED', 'READY_FOR_ACTIVATION'].includes(
        tenant.lifecycleStatus,
      ),
    ).length;

    return {
      totalClients,
      active,
      onboarding,
      newApplications,
      openTasks,
      urgentTasks,
      openSupport,
      ...(includeRestricted ? { trialing, pastDue, canceled } : {}),
    };
  }

  async communications(filters: {
    tenantId?: string;
    channel?: string;
    status?: string;
    take?: number;
    skip?: number;
  }) {
    const take = Math.min(Math.max(filters.take || 50, 1), 100);
    const skip = Math.max(filters.skip || 0, 0);
    const query = this.messagesRepo
      .createQueryBuilder('message')
      .innerJoin('message.lead', 'lead')
      .select([
        'message.id',
        'message.channel',
        'message.direction',
        'message.body',
        'message.status',
        'message.providerStatus',
        'message.createdAt',
        'lead.id',
        'lead.fullName',
        'lead.tenantId',
      ])
      .orderBy('message.createdAt', 'DESC')
      .take(take)
      .skip(skip);
    if (filters.tenantId) query.andWhere('lead.tenant_id = :tenantId', { tenantId: filters.tenantId });
    if (filters.channel) query.andWhere('message.channel = :channel', { channel: filters.channel });
    if (filters.status) query.andWhere('message.status = :status', { status: filters.status });
    const rows = await query.getMany();
    return rows.map((message) => ({
      id: message.id,
      tenantId: message.lead?.tenantId,
      leadId: message.leadId,
      leadName: message.lead?.fullName || 'Lead',
      channel: message.channel,
      direction: message.direction,
      body: message.body.slice(0, 1000),
      status: message.status,
      providerStatus: message.providerStatus || null,
      createdAt: message.createdAt,
    }));
  }

  async integrationOverview() {
    const rows = await this.credentialsRepo.find({
      relations: ['tenant'],
      order: { updatedAt: 'DESC' },
      take: 500,
    });
    return rows.map((row) => {
      const payload = decryptIntegrationPayload(row.encryptedValue) || {};
      return {
        tenantId: row.tenant?.id || null,
        tenantName: row.tenant?.name || 'Unknown workspace',
        provider: row.provider,
        status: payload.error
          ? 'error'
          : payload.connected
            ? 'connected'
            : payload.configured
              ? 'configured'
              : 'disconnected',
        needsAttention: Boolean(payload.error),
        lastTestedAt: payload.lastSync || null,
        updatedAt: row.updatedAt,
      };
    });
  }

  async financialOverview(now = new Date()) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const from30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [candidateTenants, internalIds] = await Promise.all([
      this.tenantsRepo.find({
        where: {
          status: In(['active', 'trialing', 'past_due', 'unpaid', 'canceled']),
        } as any,
      }),
      this.internalTenantIds(),
    ]);
    const billableTenants = candidateTenants.filter((tenant) => !internalIds.has(tenant.id));
    const mrrByCurrency: Record<string, number> = {};
    for (const tenant of billableTenants.filter((row) => ['active', 'trialing'].includes(row.status))) {
      if (tenant.stripeUnitAmount == null || !tenant.stripeCurrency) continue;
      const normalized =
        tenant.stripeRecurringInterval === 'year'
          ? tenant.stripeUnitAmount / 12
          : tenant.stripeUnitAmount;
      mrrByCurrency[tenant.stripeCurrency] =
        (mrrByCurrency[tenant.stripeCurrency] || 0) + normalized;
    }
    const aggregate = async (from: Date, livemode: boolean) => {
      if (!this.billingEventsRepo) return [];
      const query = this.billingEventsRepo
        .createQueryBuilder('event')
        .select('event.currency', 'currency')
        .addSelect(
          `SUM(CASE WHEN event.event_type = 'invoice_paid' THEN event.amount_cents WHEN event.event_type = 'refund' THEN -event.amount_cents ELSE 0 END)`,
          'amountCents',
        )
        .where('event.livemode = :livemode', { livemode })
        .andWhere('event.occurred_at >= :from', { from });
      if (internalIds.size) {
        query.andWhere('(event.tenant_id IS NULL OR event.tenant_id NOT IN (:...internalIds))', {
          internalIds: [...internalIds],
        });
      }
      return query.groupBy('event.currency').getRawMany();
    };
    const recentEventsPromise: Promise<BillingEvent[]> = this.billingEventsRepo
      ? this.billingEventsRepo.find({
          where: { livemode: true, occurredAt: MoreThanOrEqual(from30) },
          relations: { tenant: true },
          order: { occurredAt: 'DESC' },
          take: 20,
        })
      : Promise.resolve([]);
    const eventCountsPromise: Promise<Array<{ eventType: string; count: string }>> = (() => {
      if (!this.billingEventsRepo) return Promise.resolve([]);
      const query = this.billingEventsRepo
        .createQueryBuilder('event')
        .select('event.event_type', 'eventType')
        .addSelect('COUNT(*)', 'count')
        .where('event.livemode = true')
        .andWhere('event.occurred_at >= :from', { from: from30 });
      if (internalIds.size) {
        query.andWhere('(event.tenant_id IS NULL OR event.tenant_id NOT IN (:...internalIds))', {
          internalIds: [...internalIds],
        });
      }
      return query.groupBy('event.event_type').getRawMany();
    })();
    const [collectedThisMonth, collectedThisYear, testCollectedThisMonth, recentEvents, eventCounts] =
      await Promise.all([
        aggregate(monthStart, true),
        aggregate(yearStart, true),
        aggregate(monthStart, false),
        recentEventsPromise,
        eventCountsPromise,
      ]);
    const eventCounts30 = Object.fromEntries(
      eventCounts.map((row) => [row.eventType, Number(row.count || 0)]),
    );
    const upcomingCutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return {
      mrrByCurrency,
      live: {
        collectedThisMonth,
        collectedThisYear,
        eventCounts30,
        recentEvents: recentEvents
          .filter((event) => !event.tenantId || !internalIds.has(event.tenantId))
          .map((event) => ({
            id: event.id,
            tenantId: event.tenantId || null,
            tenantName: event.tenant?.name || 'Unmatched Stripe event',
            eventType: event.eventType,
            amountCents: event.amountCents,
            currency: event.currency,
            occurredAt: event.occurredAt,
          })),
      },
      test: {
        collectedThisMonth: testCollectedThisMonth,
      },
      subscriptionCounts: {
        active: billableTenants.filter((tenant) => tenant.status === 'active').length,
        trialing: billableTenants.filter((tenant) => tenant.status === 'trialing').length,
        pastDue: billableTenants.filter((tenant) => ['past_due', 'unpaid'].includes(tenant.status)).length,
        canceled: billableTenants.filter((tenant) => tenant.status === 'canceled').length,
      },
      upcomingRenewals: billableTenants
        .filter((tenant) =>
          ['active', 'trialing'].includes(tenant.status) &&
          Boolean(tenant.currentPeriodEnd) &&
          tenant.currentPeriodEnd! >= now &&
          tenant.currentPeriodEnd! <= upcomingCutoff,
        )
        .sort((a, b) => a.currentPeriodEnd!.getTime() - b.currentPeriodEnd!.getTime())
        .slice(0, 10)
        .map((tenant) => ({
          tenantId: tenant.id,
          tenantName: tenant.name || 'Client workspace',
          renewsAt: tenant.currentPeriodEnd,
          amountCents: tenant.stripeUnitAmount,
          currency: tenant.stripeCurrency,
        })),
      pastDueClients: billableTenants.filter((tenant) =>
        ['past_due', 'unpaid'].includes(tenant.status),
      ).length,
      calculatedAt: now.toISOString(),
    };
  }

  async businessReport(includeFinancial = false, now = new Date()) {
    const day = 24 * 60 * 60 * 1000;
    const from30 = new Date(now.getTime() - 30 * day);
    const from90 = new Date(now.getTime() - 90 * day);
    const applicationPromise: Promise<ProspectApplication[]> = this.applicationsRepo
      ? this.applicationsRepo.find({
          where: { createdAt: MoreThanOrEqual(from90) },
          order: { createdAt: 'ASC' },
        })
      : Promise.resolve([]);
    const supportPromise: Promise<SupportTicket[]> = this.supportRepo
      ? this.supportRepo.find({ where: { createdAt: MoreThanOrEqual(from90) } })
      : Promise.resolve([]);
    const billingPromise: Promise<BillingEvent[]> =
      includeFinancial && this.billingEventsRepo
        ? this.billingEventsRepo.find({
            where: {
              livemode: true,
              occurredAt: MoreThanOrEqual(from90),
            },
            order: { occurredAt: 'ASC' },
          })
        : Promise.resolve([]);
    const internalIds = await this.internalTenantIds();
    const [applications, clientCandidates, tickets, billingEvents] = await Promise.all([
      applicationPromise,
      this.tenantsRepo.find({
        where: { createdAt: MoreThanOrEqual(from90) },
        order: { createdAt: 'ASC' },
      }),
      supportPromise,
      billingPromise,
    ]);
    const clients = clientCandidates.filter((tenant) => !internalIds.has(tenant.id));
    const recentApplications = applications.filter((row) => row.createdAt >= from30);
    const accepted = recentApplications.filter((row) => row.status === 'accepted').length;
    const launchDurations = clients
      .filter((row) => row.serviceActivatedAt && row.serviceActivatedAt >= row.createdAt)
      .map((row) => (row.serviceActivatedAt!.getTime() - row.createdAt.getTime()) / (60 * 60 * 1000));
    const revenueByCurrency: Record<string, number> = {};
    for (const event of billingEvents.filter((row) => row.occurredAt >= from30)) {
      const sign = event.eventType === 'refund' ? -1 : event.eventType === 'invoice_paid' ? 1 : 0;
      revenueByCurrency[event.currency] =
        (revenueByCurrency[event.currency] || 0) + sign * Number(event.amountCents || 0);
    }
    const weekly = Array.from({ length: 8 }, (_, index) => {
      const start = new Date(now.getTime() - (7 - index) * 7 * day);
      const end = new Date(start.getTime() + 7 * day);
      return {
        start: start.toISOString(),
        applications: applications.filter((row) => row.createdAt >= start && row.createdAt < end).length,
        clients: clients.filter((row) => row.createdAt >= start && row.createdAt < end).length,
      };
    });
    return {
      last30Days: {
        applications: recentApplications.length,
        consultations: recentApplications.filter((row) =>
          ['consultation_booked', 'accepted'].includes(row.status),
        ).length,
        accepted,
        conversionRate:
          recentApplications.length > 0
            ? Math.round((accepted / recentApplications.length) * 1000) / 10
            : null,
        newClients: clients.filter((row) => row.createdAt >= from30).length,
        supportRequests: tickets.filter((row) => row.createdAt >= from30).length,
        averageHoursToLaunch: launchDurations.length
          ? Math.round(
              (launchDurations.reduce((sum, value) => sum + value, 0) /
                launchDurations.length) *
                10,
            ) / 10
          : null,
        ...(includeFinancial ? { collectedByCurrency: revenueByCurrency } : {}),
      },
      weekly,
      calculatedAt: now.toISOString(),
    };
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
      environment: environmentReadiness(),
    };
  }
}
