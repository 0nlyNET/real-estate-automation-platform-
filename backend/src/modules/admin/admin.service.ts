import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import Stripe = require('stripe');
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

const ACTIVE_BILLING_STATES = new Set(['active', 'trialing']);
const OPEN_TASK_STATES = new Set(['open', 'in_progress', 'blocked']);
const OPEN_SUPPORT_STATES = new Set(['open', 'acknowledged']);
const OPEN_LEAD_STAGES = new Set([
  'new',
  'contacted',
  'qualified',
  'appointment_set',
  'showing_scheduled',
  'offer_out',
  'under_contract',
  'nurture',
]);

function startOfMonth(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function startOfPreviousMonth(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
}

function startOfYear(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
}

function percentageChange(current: number, previous: number) {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly stripe: Stripe | null;

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
    @InjectRepository(OnboardingRecord)
    private readonly onboardingRepo?: Repository<OnboardingRecord>,
  ) {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    this.stripe = key ? new Stripe(key) : null;
  }

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
    const now = new Date();
    const monthStart = startOfMonth(now);
    const previousMonthStart = startOfPreviousMonth(now);
    const yearStart = startOfYear(now);

    const [tenants, leads, applications, tasks, supportTickets, onboarding] =
      await Promise.all([
        this.tenantsRepo.find(),
        this.leadsRepo.find(),
        this.applicationsRepo?.find() || Promise.resolve([]),
        this.operationsRepo?.find() || Promise.resolve([]),
        this.supportRepo?.find() || Promise.resolve([]),
        this.onboardingRepo?.find() || Promise.resolve([]),
      ]);

    const createdThisMonth = tenants.filter((tenant) => tenant.createdAt >= monthStart);
    const createdPreviousMonth = tenants.filter(
      (tenant) => tenant.createdAt >= previousMonthStart && tenant.createdAt < monthStart,
    );
    const applicationsThisMonth = applications.filter(
      (application) => application.createdAt >= monthStart,
    );
    const applicationsPreviousMonth = applications.filter(
      (application) =>
        application.createdAt >= previousMonthStart && application.createdAt < monthStart,
    );
    const openTasks = tasks.filter((task) => OPEN_TASK_STATES.has(task.status));
    const overdueTasks = openTasks.filter(
      (task) => task.dueAt && task.dueAt.getTime() < now.getTime(),
    );
    const onboardingByTenant = new Map(onboarding.map((record) => [record.tenantId, record]));
    const clientsOnboarding = tenants.filter(
      (tenant) =>
        tenant.lifecycleStatus === 'ONBOARDING' ||
        tenant.lifecycleStatus === 'READY_FOR_UAT' ||
        tenant.lifecycleStatus === 'UAT_FAILED' ||
        tenant.lifecycleStatus === 'READY_FOR_ACTIVATION',
    );
    const incompleteOnboarding = clientsOnboarding.filter((tenant) => {
      const record = onboardingByTenant.get(tenant.id);
      return !record || record.activationStatus === 'incomplete' || record.activationStatus === 'blocked';
    });
    const activeClients = tenants.filter(
      (tenant) => tenant.status === 'active' && tenant.lifecycleStatus === 'ACTIVE',
    );
    const openApplications = applications.filter(
      (application) => !['accepted', 'declined'].includes(application.status),
    );
    const awaitingResponse = applications.filter((application) => application.status === 'new');
    const openSupport = supportTickets.filter((ticket) => OPEN_SUPPORT_STATES.has(ticket.status));
    const urgentSupport = openSupport.filter(
      (ticket) => ticket.severity === 'urgent' || ticket.severity === 'high',
    );
    const openLeads = leads.filter((lead) => OPEN_LEAD_STAGES.has(lead.stage));
    const integrationAttention = openTasks.filter((task) =>
      [
        'notification_failure',
        'payment_failure',
        'unknown_stripe_price',
        'provider_failure',
        'integration_failure',
        'webhook_failure',
      ].includes(task.category),
    );

    const revenue = await this.revenueSnapshot(tenants, monthStart, yearStart);

    return {
      generatedAt: now.toISOString(),
      clients: {
        total: tenants.length,
        active: activeClients.length,
        newThisMonth: createdThisMonth.length,
        onboarding: clientsOnboarding.length,
        incompleteOnboarding: incompleteOnboarding.length,
        pastDue: tenants.filter((tenant) => tenant.status === 'past_due' || tenant.status === 'unpaid').length,
        canceled: tenants.filter((tenant) => tenant.status === 'canceled').length,
        changeVsPreviousMonth: percentageChange(
          createdThisMonth.length,
          createdPreviousMonth.length,
        ),
      },
      leads: {
        open: openLeads.length,
        applicationsOpen: openApplications.length,
        applicationsNew: awaitingResponse.length,
        applicationsThisMonth: applicationsThisMonth.length,
        conversionRate: applications.length
          ? Math.round(
              (applications.filter((application) => application.status === 'accepted').length /
                applications.length) *
                1000,
            ) / 10
          : null,
        changeVsPreviousMonth: percentageChange(
          applicationsThisMonth.length,
          applicationsPreviousMonth.length,
        ),
      },
      billing: {
        ...revenue,
        outstandingPayments: tenants.filter(
          (tenant) => tenant.status === 'past_due' || tenant.status === 'unpaid',
        ).length,
        failedPayments: tenants.filter((tenant) => Boolean(tenant.lastPaymentFailureAt)).length,
        canceledSubscriptions: tenants.filter(
          (tenant) => tenant.status === 'canceled' || tenant.stripeSubscriptionStatus === 'canceled',
        ).length,
      },
      operations: {
        openTasks: openTasks.length,
        overdueTasks: overdueTasks.length,
        highPriorityTasks: openTasks.filter(
          (task) => task.priority === 'high' || task.priority === 'critical',
        ).length,
        openSupport: openSupport.length,
        urgentSupport: urgentSupport.length,
        integrationsRequiringAttention: integrationAttention.length,
      },
    };
  }

  private async revenueSnapshot(
    tenants: Tenant[],
    monthStart: Date,
    yearStart: Date,
  ): Promise<{
    available: boolean;
    currency: string | null;
    monthlyRecurringRevenue: number | null;
    collectedThisMonth: number | null;
    collectedThisYear: number | null;
    note: string | null;
  }> {
    if (!this.stripe) {
      return {
        available: false,
        currency: null,
        monthlyRecurringRevenue: null,
        collectedThisMonth: null,
        collectedThisYear: null,
        note: 'Connect Stripe to display verified revenue totals.',
      };
    }

    try {
      const [monthInvoices, yearInvoices] = await Promise.all([
        this.listPaidInvoices(monthStart),
        this.listPaidInvoices(yearStart),
      ]);
      const currencies = new Set(
        [...monthInvoices, ...yearInvoices]
          .map((invoice) => invoice.currency)
          .filter(Boolean),
      );
      if (currencies.size > 1) {
        return {
          available: false,
          currency: null,
          monthlyRecurringRevenue: null,
          collectedThisMonth: null,
          collectedThisYear: null,
          note: 'Revenue totals are unavailable because Stripe contains multiple currencies.',
        };
      }

      let mrr = 0;
      const mrrCurrencies = new Set<string>();
      for (const tenant of tenants) {
        if (
          !tenant.stripeSubscriptionId ||
          !ACTIVE_BILLING_STATES.has(
            String(tenant.stripeSubscriptionStatus || tenant.status),
          )
        ) {
          continue;
        }
        const subscription = await this.stripe.subscriptions.retrieve(
          tenant.stripeSubscriptionId,
        );
        for (const item of subscription.items.data) {
          const price = item.price;
          const amount = price.unit_amount;
          if (amount === null || !price.recurring) continue;
          mrrCurrencies.add(price.currency);
          const quantity = item.quantity || 1;
          const intervalCount = price.recurring.interval_count || 1;
          const monthlyFactor =
            price.recurring.interval === 'month'
              ? 1 / intervalCount
              : price.recurring.interval === 'year'
                ? 1 / (12 * intervalCount)
                : price.recurring.interval === 'week'
                  ? 52 / (12 * intervalCount)
                  : 365 / (12 * intervalCount);
          mrr += amount * quantity * monthlyFactor;
        }
      }

      const combinedCurrencies = new Set([...currencies, ...mrrCurrencies]);
      if (combinedCurrencies.size > 1) {
        return {
          available: false,
          currency: null,
          monthlyRecurringRevenue: null,
          collectedThisMonth: null,
          collectedThisYear: null,
          note: 'Revenue totals are unavailable because Stripe contains multiple currencies.',
        };
      }

      const currency = [...combinedCurrencies][0] || 'usd';
      return {
        available: true,
        currency,
        monthlyRecurringRevenue: Math.round(mrr),
        collectedThisMonth: monthInvoices.reduce(
          (total, invoice) => total + invoice.amount_paid,
          0,
        ),
        collectedThisYear: yearInvoices.reduce(
          (total, invoice) => total + invoice.amount_paid,
          0,
        ),
        note: null,
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Admin revenue snapshot unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        available: false,
        currency: null,
        monthlyRecurringRevenue: null,
        collectedThisMonth: null,
        collectedThisYear: null,
        note: 'Stripe could not be reached. Client and payment-status counts remain current.',
      };
    }
  }

  private async listPaidInvoices(createdAfter: Date) {
    if (!this.stripe) return [];
    const invoices: Stripe.Invoice[] = [];
    let startingAfter: string | undefined;
    do {
      const page = await this.stripe.invoices.list({
        status: 'paid',
        created: { gte: Math.floor(createdAfter.getTime() / 1000) },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      invoices.push(...page.data);
      startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (startingAfter);
    return invoices;
  }

  async systemHealth() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

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
