import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { resolvePlatformRole } from '../../common/env';
import { operationalEvent } from '../../common/operational-log';
import { Appointment } from '../client-operations/appointment.entity';
import { DurableJobsService } from '../durable-jobs/durable-jobs.service';
import { Lead } from '../leads/lead.entity';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { AdminNotification } from './notification.entity';
import { NotificationIncident } from './notification-incident.entity';
import { NotificationsService } from './notifications.service';
import { TemplateContext } from './notification-templates';

const DIGEST_TIMEZONE = 'America/New_York';
const DIGEST_HOUR = 7;

function tzOffsetMs(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return (
    Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) -
    date.getTime()
  );
}

/** Next occurrence of hour:00 in the given timezone. */
export function nextDailyAt(hour: number, timeZone: string, from = new Date()): Date {
  const offset = tzOffsetMs(timeZone, from);
  const wallNow = new Date(from.getTime() + offset);
  const target = new Date(wallNow);
  target.setUTCHours(hour, 0, 0, 0);
  if (target.getTime() <= wallNow.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  return new Date(target.getTime() - offset);
}

/** Next Monday at hour:00 in the given timezone. */
export function nextWeeklyAt(hour: number, timeZone: string, from = new Date()): Date {
  const next = nextDailyAt(hour, timeZone, from);
  const offset = tzOffsetMs(timeZone, next);
  const wall = new Date(next.getTime() + offset);
  const day = wall.getUTCDay(); // 0 = Sunday
  const daysUntilMonday = (8 - day) % 7 || 7;
  wall.setUTCDate(wall.getUTCDate() + daysUntilMonday);
  return new Date(wall.getTime() - offset);
}

export type ClientDigestStats = {
  newLeads: number;
  aiConversations: number;
  humanHandoffs: number;
  qualifiedLeads: number;
  appointmentsBooked: number;
  upcomingAppointments: number;
  leadsNeedingAttention: number;
  unresolvedNotifications: number;
  integrationHealth: string;
  actionItems: string[];
};

/**
 * Daily/weekly digest emails. Aggregates the last 24h (or 7d) of activity per
 * tenant and platform-wide, then sends one summary email instead of many
 * one-off notifications.
 */
@Injectable()
export class NotificationDigestService implements OnModuleInit {
  private readonly logger = new Logger(NotificationDigestService.name);

  constructor(
    private readonly notifications: NotificationsService,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(AdminNotification)
    private readonly adminNotifications: Repository<AdminNotification>,
    @Optional() @InjectRepository(Lead)
    private readonly leads?: Repository<Lead>,
    @Optional() @InjectRepository(Appointment)
    private readonly appointments?: Repository<Appointment>,
    @Optional() @InjectRepository(Tenant)
    private readonly tenants?: Repository<Tenant>,
    @Optional() @InjectRepository(NotificationIncident)
    private readonly incidents?: Repository<NotificationIncident>,
    @Optional() private readonly durableJobs?: DurableJobsService,
  ) {}

  onModuleInit() {
    if (!this.durableJobs) return;
    this.durableJobs.register('notifications.client_digest', async (job) => {
      const tenantId = String((job.payload as any)?.tenantId || '');
      if (tenantId) await this.sendClientDailyDigest({ tenantId });
      return { nextRunAt: nextDailyAt(DIGEST_HOUR, DIGEST_TIMEZONE) };
    });
    this.durableJobs.register('notifications.admin_digest', async () => {
      await this.sendAdminDailyDigest();
      return { nextRunAt: nextDailyAt(DIGEST_HOUR, DIGEST_TIMEZONE) };
    });
    this.durableJobs.register('notifications.weekly_digest', async () => {
      await this.sendWeeklySummary();
      return { nextRunAt: nextWeeklyAt(DIGEST_HOUR, DIGEST_TIMEZONE) };
    });
    if (process.env.NODE_ENV === 'test') return;
    void this.durableJobs.schedule({
      taskType: 'notifications.admin_digest',
      dedupeKey: 'recurring:notifications.admin_digest',
      nextRunAt: nextDailyAt(DIGEST_HOUR, DIGEST_TIMEZONE),
    });
    void this.durableJobs.schedule({
      taskType: 'notifications.weekly_digest',
      dedupeKey: 'recurring:notifications.weekly_digest',
      nextRunAt: nextWeeklyAt(DIGEST_HOUR, DIGEST_TIMEZONE),
    });
    void this.scheduleTenantDigests().catch((error: unknown) => {
      this.logger.error(
        operationalEvent('digest_schedule_failed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }

  private async scheduleTenantDigests() {
    if (!this.tenants || !this.durableJobs) return;
    const tenants = await this.tenants.find();
    for (const tenant of tenants) {
      await this.durableJobs.schedule({
        taskType: 'notifications.client_digest',
        tenantId: tenant.id,
        dedupeKey: `recurring:notifications.client_digest:${tenant.id}`,
        payload: { tenantId: tenant.id },
        nextRunAt: nextDailyAt(DIGEST_HOUR, DIGEST_TIMEZONE),
      });
    }
  }

  async collectClientDigestStats(tenantId: string, sinceHours = 24): Promise<ClientDigestStats> {
    const since = new Date(Date.now() - sinceHours * 60 * 60_000);
    const stats: ClientDigestStats = {
      newLeads: 0,
      aiConversations: 0,
      humanHandoffs: 0,
      qualifiedLeads: 0,
      appointmentsBooked: 0,
      upcomingAppointments: 0,
      leadsNeedingAttention: 0,
      unresolvedNotifications: 0,
      integrationHealth: 'All systems operational',
      actionItems: [],
    };
    try {
      if (this.leads) {
        stats.newLeads = await this.leads.count({
          where: { tenantId, createdAt: MoreThan(since) as any },
        });
        stats.qualifiedLeads = await this.leads.count({
          where: { tenantId, stage: 'qualified' as any, createdAt: MoreThan(since) as any },
        });
      }
    } catch (error: unknown) {
      this.logger.warn(operationalEvent('digest_lead_aggregation_failed', { tenantId }));
    }
    try {
      if (this.appointments) {
        stats.appointmentsBooked = await this.appointments.count({
          where: { tenantId, createdAt: MoreThan(since) as any },
        });
        stats.upcomingAppointments = await this.appointments.count({
          where: {
            tenantId,
            startsAt: MoreThan(new Date()) as any,
            status: 'scheduled' as any,
          },
        });
      }
    } catch {
      this.logger.warn(operationalEvent('digest_appointment_aggregation_failed', { tenantId }));
    }
    try {
      // Tenant-scoped via the recipients: a notification belongs to a tenant
      // when its recipient is a user of that tenant. Never leak another
      // tenant's notifications into this digest.
      const tenantUserIds = (
        await this.users.find({ where: { tenantId, isActive: true } })
      ).map((u) => u.id);
      if (tenantUserIds.length) {
        stats.humanHandoffs = await this.adminNotifications.count({
          where: {
            recipientUserId: In(tenantUserIds),
            eventType: 'handoff.created',
            createdAt: MoreThan(since),
          },
        });
        const attention = await this.adminNotifications.find({
          where: {
            recipientUserId: In(tenantUserIds),
            readAt: null as any,
            createdAt: MoreThan(since),
          },
          order: { createdAt: 'DESC' },
          take: 5,
        });
        stats.leadsNeedingAttention = attention.length;
        stats.actionItems = attention.map((n) => n.title).filter(Boolean);
        stats.unresolvedNotifications = await this.adminNotifications.count({
          where: {
            recipientUserId: In(tenantUserIds),
            readAt: IsNull(),
            createdAt: MoreThan(since),
          },
        });
      }
    } catch {
      this.logger.warn(operationalEvent('digest_notification_aggregation_failed', { tenantId }));
    }
    return stats;
  }

  /**
   * Sends the daily digest to tenant owners/admins with digest enabled.
   * Strictly tenant-scoped: only this tenant's data and users are touched.
   */
  async sendClientDailyDigest(input: { tenantId: string }): Promise<{ sent: number }> {
    const { tenantId } = input;
    const owners = await this.users.find({
      where: { tenantId, isActive: true, isEmailVerified: true },
    });
    const recipients = owners.filter((u) => u.role === 'owner' || u.role === 'admin');
    if (!recipients.length) return { sent: 0 };
    const stats = await this.collectClientDigestStats(tenantId);
    const tenantName = await this.tenantName(tenantId);
    const ctx: TemplateContext = {
      tenantName,
      date: new Date().toLocaleDateString('en-US', { timeZone: DIGEST_TIMEZONE }),
      newLeads: stats.newLeads,
      aiConversations: stats.aiConversations,
      humanHandoffs: stats.humanHandoffs,
      qualifiedLeads: stats.qualifiedLeads,
      appointmentsBooked: stats.appointmentsBooked,
      upcomingAppointments: stats.upcomingAppointments,
      leadsNeedingAttention: stats.leadsNeedingAttention,
      unresolvedNotifications: stats.unresolvedNotifications,
      integrationHealth: stats.integrationHealth,
      actionItems: stats.actionItems.join('\n'),
      actionPath: '/app/dashboard',
    };
    const created: AdminNotification[] = [];
    for (const recipient of recipients) {
      const preference = await this.notifications.getPreferences(recipient.id);
      if (!preference.dailyDigestEnabled || !preference.emailEnabled) continue;
      const rows = await this.notifications.createForTenant({
        tenantId,
        exactRecipientIds: [recipient.id],
        eventType: 'digest.daily_client',
        category: 'clients',
        severity: 'info',
        title: 'Daily summary',
        message: 'Your RealtyTechAI daily summary is ready.',
        deduplicationKey: `digest:client:${tenantId}:${new Date().toISOString().slice(0, 10)}:${recipient.id}`,
        actionUrl: '/app/dashboard',
        templateId: 'digest.daily_client',
        templateContext: ctx,
      });
      created.push(...rows);
    }
    return { sent: created.length };
  }

  async sendAdminDailyDigest() {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const ctx: TemplateContext = {
      date: new Date().toLocaleDateString('en-US', { timeZone: DIGEST_TIMEZONE }),
      actionPath: '/admin/dashboard',
    };
    try {
      if (this.tenants) {
        const tenants = await this.tenants.find();
        const byStatus = (s: string) =>
          tenants.filter((t: any) =>
            String(t.status || t.lifecycleStatus || '').toUpperCase().includes(s),
          ).length;
        ctx.clientsActive = byStatus('ACTIVE');
        ctx.clientsOnboarding = byStatus('ONBOARD');
        ctx.clientsTesting = byStatus('TEST');
        ctx.clientsPaused = tenants.filter((t: any) =>
          ['PAUSED', 'SUSPENDED'].some((s) =>
            String(t.status || t.lifecycleStatus || '').toUpperCase().includes(s),
          ),
        ).length;
      }
    } catch {
      this.logger.warn(operationalEvent('digest_tenant_aggregation_failed', {}));
    }
    try {
      if (this.incidents) {
        ctx.unresolvedIncidents = await this.incidents.count({
          where: [{ status: 'open' }, { status: 'escalated' }] as any,
        });
        ctx.providerFailures = await this.incidents.count({
          where: { createdAt: MoreThan(since) } as any,
        });
      }
    } catch {
      this.logger.warn(operationalEvent('digest_incident_aggregation_failed', {}));
    }
    try {
      ctx.automationPauses = await this.adminNotifications.count({
        where: { eventType: 'automation.paused', createdAt: MoreThan(since) },
      });
      const ready = await this.adminNotifications.count({
        where: { eventType: 'client.ready_for_activation', createdAt: MoreThan(since) },
      });
      const blocked = await this.adminNotifications.count({
        where: { eventType: 'client.activation_blocked', createdAt: MoreThan(since) },
      });
      ctx.readyForActivation = ready;
      ctx.blockedOnboarding = blocked;
      const topIssues = await this.adminNotifications.find({
        where: { severity: 'critical', createdAt: MoreThan(since) },
        order: { createdAt: 'DESC' },
        take: 5,
      });
      ctx.topIssues = topIssues.map((n) => n.title).filter(Boolean).join('\n');
    } catch {
      this.logger.warn(operationalEvent('digest_admin_aggregation_failed', {}));
    }
    try {
      const rows: Array<{ severity: string; count: string }> =
        await this.adminNotifications
          .createQueryBuilder('n')
          .select('n.severity', 'severity')
          .addSelect('COUNT(*)', 'count')
          .andWhere('n.createdAt > :since', { since })
          .groupBy('n.severity')
          .getRawMany();
      let total = 0;
      let critical = 0;
      let warning = 0;
      for (const row of rows || []) {
        const count = Number(row.count) || 0;
        total += count;
        if (row.severity === 'critical') critical += count;
        if (row.severity === 'warning') warning += count;
      }
      ctx.totalNotifications = total;
      ctx.criticalCount = critical;
      ctx.warningCount = warning;
    } catch {
      this.logger.warn(operationalEvent('digest_admin_severity_failed', {}));
    }
    return this.notifications.createForPlatform({
      eventType: 'digest.daily_admin',
      category: 'system',
      severity: 'info',
      audience: 'super_admin',
      exactRecipientIds:
        await this.digestEnabledOperatorIds('dailyDigestEnabled'),
      title: 'Daily operations digest',
      message: 'Your RealtyTechAI daily operations digest is ready.',
      deduplicationKey: `digest:admin:${new Date().toISOString().slice(0, 10)}`,
      actionUrl: '/admin/dashboard',
      templateId: 'digest.daily_admin',
      templateContext: ctx,
    });
  }

  /** Optional weekly rollup for platform admins and tenant owners. */
  async sendWeeklySummary() {
    const admins = await this.notifications.createForPlatform({
      eventType: 'digest.weekly_admin',
      category: 'system',
      severity: 'info',
      audience: 'super_admin',
      exactRecipientIds:
        await this.digestEnabledOperatorIds('weeklyDigestEnabled'),
      title: 'Weekly operations summary',
      message: 'Your RealtyTechAI weekly operations summary is ready.',
      deduplicationKey: `digest:weekly:admin:${weekKey()}`,
      actionUrl: '/admin/dashboard',
      templateId: 'digest.daily_admin',
      templateContext: {
        date: `week of ${new Date().toLocaleDateString('en-US', { timeZone: DIGEST_TIMEZONE })}`,
        actionPath: '/admin/dashboard',
        topIssues: '',
      },
    });
    const perTenant: AdminNotification[] = [];
    if (this.tenants) {
      try {
        const tenants = await this.tenants.find();
        for (const tenant of tenants) {
          const owners = await this.users.find({
            where: { tenantId: tenant.id, isActive: true, isEmailVerified: true },
          });
          for (const owner of owners.filter((u) => u.role === 'owner')) {
            const preference = await this.notifications.getPreferences(owner.id);
            if (!preference.weeklyDigestEnabled || !preference.emailEnabled) continue;
            const stats = await this.collectClientDigestStats(tenant.id, 24 * 7);
            const rows = await this.notifications.createForTenant({
              tenantId: tenant.id,
              exactRecipientIds: [owner.id],
              eventType: 'digest.weekly_client',
              category: 'clients',
              severity: 'info',
              title: 'Weekly summary',
              message: 'Your RealtyTechAI weekly summary is ready.',
              deduplicationKey: `digest:weekly:client:${tenant.id}:${weekKey()}:${owner.id}`,
              actionUrl: '/app/dashboard',
              templateId: 'digest.daily_client',
              templateContext: {
                tenantName: (tenant as any).name || 'your workspace',
                date: `week of ${new Date().toLocaleDateString('en-US', { timeZone: DIGEST_TIMEZONE })}`,
                newLeads: stats.newLeads,
                aiConversations: stats.aiConversations,
                humanHandoffs: stats.humanHandoffs,
                qualifiedLeads: stats.qualifiedLeads,
                appointmentsBooked: stats.appointmentsBooked,
                leadsNeedingAttention: stats.leadsNeedingAttention,
                integrationHealth: stats.integrationHealth,
                actionItems: stats.actionItems.join('\n'),
                actionPath: '/app/dashboard',
              },
            });
            perTenant.push(...rows);
          }
        }
      } catch (error: unknown) {
        this.logger.warn(
          operationalEvent('digest_weekly_tenant_failed', {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    return [...admins, ...perTenant];
  }

  private async tenantName(tenantId: string): Promise<string> {
    try {
      const tenant = await this.tenants?.findOne({ where: { id: tenantId } as any });
      return (tenant as any)?.name || 'your workspace';
    } catch {
      return 'your workspace';
    }
  }

  /**
   * Platform operator ids with the given digest flag enabled. Admin digests
   * honor per-admin preferences instead of blasting all operators.
   */
  private async digestEnabledOperatorIds(
    flag: 'dailyDigestEnabled' | 'weeklyDigestEnabled',
  ): Promise<string[]> {
    try {
      const users = await this.users.find({
        where: { isActive: true, isEmailVerified: true } as any,
      });
      const operators = users.filter(
        (u) => resolvePlatformRole(u.email, (u as any).platformRole) !== null,
      );
      const ids: string[] = [];
      for (const operator of operators) {
        const preference = await this.notifications.getPreferences(operator.id);
        if (preference[flag] && preference.emailEnabled) ids.push(operator.id);
      }
      return ids;
    } catch (error: unknown) {
      this.logger.warn(
        operationalEvent('digest_operator_resolution_failed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return [];
    }
  }
}

function weekKey(): string {
  const now = new Date();
  const monday = new Date(now);
  const day = monday.getUTCDay();
  monday.setUTCDate(monday.getUTCDate() - ((day + 6) % 7));
  return monday.toISOString().slice(0, 10);
}
