import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { operationalEvent } from '../../common/operational-log';
import { DurableJobsService } from '../durable-jobs/durable-jobs.service';
import { AdminNotification, NotificationCategory } from './notification.entity';
import { NotificationIncidentsService } from './notification-incidents.service';
import { NotificationsService } from './notifications.service';
import { TemplateContext } from './notification-templates';

/**
 * Facade other services call to raise operational notifications. Each method
 * maps to the right template + audience + incident lifecycle so callers do
 * not need to know the notification internals.
 *
 * Tenant isolation: every tenant-scoped method only notifies users of that
 * tenant via NotificationsService.createForTenant.
 */
@Injectable()
export class OperationalEventsService implements OnModuleInit {
  private readonly logger = new Logger(OperationalEventsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly incidents: NotificationIncidentsService,
    @Optional()
    @InjectRepository(AdminNotification)
    private readonly adminNotifications?: Repository<AdminNotification>,
    @Optional() private readonly durableJobs?: DurableJobsService,
  ) {}

  onModuleInit() {
    if (!this.durableJobs) return;
    // One reminder after 4 hours if the AI handoff is still unresolved.
    this.durableJobs.register(
      'notifications.ai_handoff_reminder',
      async (job: any) => {
        await this.sendAiHandoffReminder(job?.payload);
      },
    );
  }

  private incidentKeyFor(parts: Array<string | undefined | null>): string {
    return parts.filter(Boolean).join(':');
  }

  /** Hour bucket for dedupe keys: dedupes duplicate deliveries, re-notifies later. */
  private hourBucket(): string {
    return new Date().toISOString().slice(0, 13);
  }

  /** Day bucket for one-time milestone dedupe keys. */
  private dayBucket(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // ------------------------------------------------------------------
  // Integrations
  // ------------------------------------------------------------------

  async integrationFailed(input: {
    provider: string;
    tenantId?: string | null;
    tenantName?: string;
    error?: string;
    platformImpact?: boolean;
    reconnectPath?: string;
  }) {
    const incidentKey = this.incidentKeyFor([
      'integration',
      input.provider.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      input.tenantId || 'platform',
    ]);
    const ctx: TemplateContext = {
      provider: input.provider,
      tenantName: input.tenantName,
      actionPath: input.reconnectPath || (input.tenantId ? '/app/settings/integrations' : '/admin/settings'),
      actionLabel: `Reconnect ${input.provider}`,
    };
    return this.incidents.recordFailure({
      incidentKey,
      tenantId: input.tenantId || null,
      eventType: 'integration.failed',
      category: 'integrations',
      title: `${input.provider} connection failing`,
      message: `${input.provider} has failed repeatedly${input.tenantName ? ` for ${input.tenantName}` : ''}.`,
      platformImpact: input.platformImpact,
      templateId: 'integration.disconnected',
      templateContext: ctx,
      actionUrl: String(ctx.actionPath),
      metadata: { provider: input.provider },
    });
  }

  async integrationRecovered(input: {
    provider: string;
    tenantId?: string | null;
    downtimeMinutes?: number;
  }) {
    const incidentKey = this.incidentKeyFor([
      'integration',
      input.provider.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      input.tenantId || 'platform',
    ]);
    const ctx: TemplateContext = {
      provider: input.provider,
      downtimeMinutes: input.downtimeMinutes ?? '?',
      actionPath: input.tenantId ? '/app/settings/integrations' : '/admin/settings',
    };
    return this.incidents.recordRecovery({
      incidentKey,
      tenantId: input.tenantId || null,
      eventType: 'integration.recovered',
      category: 'integrations',
      title: `${input.provider} recovered`,
      message: `${input.provider} recovered${input.downtimeMinutes ? ` after ${input.downtimeMinutes} minutes` : ''}.`,
      templateId: 'integration.recovered',
      templateContext: ctx,
      actionUrl: String(ctx.actionPath),
      metadata: { provider: input.provider },
    });
  }

  // ------------------------------------------------------------------
  // Automation safety
  // ------------------------------------------------------------------

  async automationPaused(input: {
    tenantId?: string | null;
    tenantName?: string;
    reason: string;
    actionNeeded?: string;
  }) {
    const ctx: TemplateContext = {
      tenantName: input.tenantName,
      reason: input.reason,
      actionNeeded: input.actionNeeded,
      actionPath: input.tenantId ? '/app/settings/automation' : '/admin/dashboard',
      actionLabel: 'Review automation',
    };
    const create = {
      eventType: 'automation.paused',
      category: 'system' as NotificationCategory,
      severity: 'warning' as const,
      title: input.tenantName ? `Automation paused for ${input.tenantName}` : 'Automation paused',
      message: `Automation was paused: ${input.reason}`,
      deduplicationKey: `automation-paused:${input.tenantId || 'platform'}:${this.hourBucket()}`,
      incidentKey: input.tenantId ? `automation:${input.tenantId}` : 'automation:platform',
      actionUrl: String(ctx.actionPath),
      templateId: 'automation.paused',
      templateContext: ctx,
    };
    return input.tenantId
      ? this.notifications.createForTenant({ ...create, tenantId: input.tenantId })
      : this.notifications.createForPlatform(create);
  }

  async automationResumed(input: { tenantId?: string | null; tenantName?: string }) {
    const create = {
      eventType: 'automation.resumed',
      category: 'system' as NotificationCategory,
      severity: 'success' as const,
      title: input.tenantName ? `Automation resumed for ${input.tenantName}` : 'Automation resumed',
      message: 'Automation has been resumed after the incident was resolved.',
      deduplicationKey: `automation-resumed:${input.tenantId || 'platform'}:${this.hourBucket()}`,
      incidentKey: input.tenantId ? `automation:${input.tenantId}` : 'automation:platform',
      actionUrl: input.tenantId ? '/app/settings/automation' : '/admin/dashboard',
    };
    return input.tenantId
      ? this.notifications.createForTenant({ ...create, tenantId: input.tenantId })
      : this.notifications.createForPlatform(create);
  }

  // ------------------------------------------------------------------
  // Backup / disaster recovery
  // ------------------------------------------------------------------

  async backupFailed(input: { detail: string }) {
    return this.incidents.recordFailure({
      incidentKey: 'backup:pipeline',
      eventType: 'backup.failed',
      category: 'system',
      title: 'Backup failed',
      message: input.detail,
      templateId: 'backup.failed',
      templateContext: {
        detail: input.detail,
        actionPath: '/admin/dashboard?view=backups',
      } as TemplateContext,
      actionUrl: '/admin/dashboard?view=backups',
      metadata: { detail: input.detail.slice(0, 200) },
    });
  }

  async backupRecovered(input: { downtimeMinutes?: number } = {}) {
    return this.incidents.recordRecovery({
      incidentKey: 'backup:pipeline',
      eventType: 'backup.recovered',
      category: 'system',
      title: 'Backup pipeline recovered',
      message: 'Scheduled backups are completing successfully again.',
      templateId: 'backup.recovered',
      templateContext: {
        downtimeMinutes: input.downtimeMinutes ?? '',
        actionPath: '/admin/dashboard?view=backups',
      } as TemplateContext,
      actionUrl: '/admin/dashboard?view=backups',
    });
  }

  // ------------------------------------------------------------------
  // Billing
  // ------------------------------------------------------------------

  async billingEvent(input: {
    tenantId: string;
    tenantName?: string;
    type: 'payment_failed' | 'cancelled' | 'suspended' | 'recovered';
    detail: string;
  }) {
    const copy: Record<string, { summary: string; explanation: string; ifIgnored: string }> = {
      payment_failed: {
        summary: 'payment failed',
        explanation: `A payment for ${input.tenantName || 'your workspace'} did not go through. ${input.detail}`,
        ifIgnored: 'the subscription may be suspended for non-payment.',
      },
      cancelled: {
        summary: 'subscription cancelled',
        explanation: `The subscription for ${input.tenantName || 'your workspace'} was cancelled. ${input.detail}`,
        ifIgnored: 'access ends at the end of the billing period.',
      },
      suspended: {
        summary: 'account suspended',
        explanation: `The workspace ${input.tenantName || ''} was suspended: ${input.detail}`,
        ifIgnored: 'automations stay off until billing is resolved.',
      },
      recovered: {
        summary: 'billing recovered',
        explanation: `Billing for ${input.tenantName || 'your workspace'} is healthy again. ${input.detail}`,
        ifIgnored: 'no action needed.',
      },
    };
    const c = copy[input.type];
    const severity = input.type === 'recovered' ? 'success' : 'warning';
    return this.notifications.createForTenant({
      tenantId: input.tenantId,
      eventType: `billing.${input.type}`,
      category: 'billing',
      severity,
      title: `Billing: ${c.summary}`,
      message: c.explanation,
      deduplicationKey: `billing:${input.type}:${input.tenantId}:${this.hourBucket()}`,
      actionUrl: '/app/settings/billing',
      templateId: 'billing.problem',
      templateContext: {
        summary: c.summary,
        tenantName: input.tenantName,
        explanation: c.explanation,
        ifIgnored: c.ifIgnored,
        actionPath: '/app/settings/billing',
        actionLabel: 'View billing',
      },
    });
  }

  // ------------------------------------------------------------------
  // Leads: AI handoffs and hot leads
  // ------------------------------------------------------------------

  /**
   * AI → human handoff. Notifies owners/admins plus the assigned agent only.
   * Deduplicated per lead: one email per handoff; a reminder is sent only if
   * the handoff stays unresolved (handled by the caller passing a distinct
   * handoff id for reminders).
   */
  async aiHandoff(input: {
    tenantId: string;
    leadId: string;
    leadName: string;
    leadSource?: string;
    reason: string;
    summary: string;
    aiRecommendation?: string;
    aiPaused?: boolean;
    assignedUserId?: string | null;
    handoffId?: string;
  }) {
    const dedupe = input.handoffId || `handoff:${input.leadId}`;
    const rows = await this.notifications.createForTenant({
      tenantId: input.tenantId,
      assignedUserId: input.assignedUserId || null,
      eventType: 'lead.ai_handoff',
      category: 'leads',
      severity: 'warning',
      title: `AI handed off ${input.leadName}`,
      message: `${input.reason} — ${input.summary}`,
      deduplicationKey: `ai-handoff:${dedupe}`,
      entityType: 'lead',
      entityId: input.leadId,
      actionUrl: `/app/conversations?leadId=${input.leadId}`,
      templateId: 'lead.ai_handoff',
      templateContext: {
        leadName: input.leadName,
        leadSource: input.leadSource,
        handoffReason: input.reason,
        summary: input.summary,
        aiRecommendation: input.aiRecommendation,
        aiPaused: input.aiPaused ? 'true' : 'false',
        actionPath: `/app/conversations?leadId=${input.leadId}`,
      },
    });
    // One reminder after 4 hours if the handoff is still unresolved. The
    // dedupe key on the scheduled job keeps this to a single reminder.
    if (this.durableJobs) {
      try {
        await this.durableJobs.schedule({
          taskType: 'notifications.ai_handoff_reminder',
          dedupeKey: `ai-handoff-reminder:${dedupe}`,
          payload: {
            tenantId: input.tenantId,
            dedupeKey: `ai-handoff:${dedupe}`,
            leadId: input.leadId,
            leadName: input.leadName,
            assignedUserId: input.assignedUserId || null,
            reason: input.reason,
          },
          nextRunAt: new Date(Date.now() + 4 * 60 * 60_000),
          maxAttempts: 2,
        });
      } catch (error: unknown) {
        this.logger.warn(
          operationalEvent('ai_handoff_reminder_schedule_failed', {
            tenantId: input.tenantId,
            leadId: input.leadId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    return rows;
  }

  /**
   * Sends the 4-hour handoff reminder only when the original handoff
   * notification is still unread (proxy for "unresolved"). A read handoff
   * means a human has seen it, so no reminder is sent.
   */
  private async sendAiHandoffReminder(payload: any): Promise<void> {
    try {
      const dedupeKey = String(payload?.dedupeKey || '');
      const tenantId = String(payload?.tenantId || '');
      if (!dedupeKey || !tenantId || !this.adminNotifications) return;
      const unread = await this.adminNotifications.count({
        where: { deduplicationKey: dedupeKey, readAt: IsNull() },
      });
      if (!unread) return;
      const leadId = String(payload?.leadId || '');
      await this.notifications.createForTenant({
        tenantId,
        assignedUserId: payload?.assignedUserId || null,
        eventType: 'lead.ai_handoff_reminder',
        category: 'leads',
        severity: 'warning',
        title: `Reminder: AI handed off ${payload?.leadName || 'a lead'}`,
        message:
          `This handoff is still unresolved after 4 hours` +
          (payload?.reason ? `: ${payload.reason}` : '.'),
        deduplicationKey: `ai-handoff-reminder:${dedupeKey}`,
        entityType: 'lead',
        entityId: leadId || null,
        actionUrl: leadId ? `/app/conversations?leadId=${leadId}` : null,
      });
    } catch (error: unknown) {
      this.logger.warn(
        operationalEvent('ai_handoff_reminder_failed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async hotLead(input: {
    tenantId: string;
    leadId: string;
    leadName: string;
    leadSource?: string;
    whyHot?: string;
    nextStep?: string;
    assignedUserId?: string | null;
  }) {
    return this.notifications.createForTenant({
      tenantId: input.tenantId,
      assignedUserId: input.assignedUserId || null,
      eventType: 'lead.hot_lead',
      category: 'leads',
      severity: 'warning',
      title: `Hot lead: ${input.leadName}`,
      message: input.whyHot || 'High-intent lead detected.',
      deduplicationKey: `hot-lead:${input.leadId}`,
      entityType: 'lead',
      entityId: input.leadId,
      actionUrl: `/app/conversations?leadId=${input.leadId}`,
      templateId: 'lead.hot_lead',
      templateContext: {
        leadName: input.leadName,
        leadSource: input.leadSource,
        whyHot: input.whyHot,
        nextStep: input.nextStep,
        actionPath: `/app/conversations?leadId=${input.leadId}`,
      },
    });
  }

  // ------------------------------------------------------------------
  // Appointments
  // ------------------------------------------------------------------

  async appointmentEvent(input: {
    tenantId: string;
    type: 'booked' | 'rescheduled' | 'cancelled' | 'failed';
    appointmentId?: string;
    leadId: string;
    leadName: string;
    leadSource?: string;
    when?: string;
    qualification?: string;
    details?: string;
    assignedUserId?: string | null;
  }) {
    const isBooked = input.type === 'booked';
    const stableId = input.appointmentId || input.leadId;
    return this.notifications.createForTenant({
      tenantId: input.tenantId,
      assignedUserId: input.assignedUserId || null,
      eventType: `appointment.${input.type}`,
      category: 'tasks',
      severity: isBooked ? 'success' : 'warning',
      title: isBooked ? `Appointment booked: ${input.leadName}` : `Appointment ${input.type}: ${input.leadName}`,
      message: input.details || `${input.leadName} — ${input.when || ''}`,
      deduplicationKey: `appointment:${input.type}:${stableId}:${this.hourBucket()}`,
      entityType: 'appointment',
      entityId: input.appointmentId || null,
      actionUrl: `/app/conversations?leadId=${input.leadId}`,
      templateId: isBooked ? 'appointment.booked' : 'appointment.changed',
      templateContext: {
        leadName: input.leadName,
        leadSource: input.leadSource,
        when: input.when,
        qualification: input.qualification,
        changeType: input.type,
        details: input.details,
        actionPath: `/app/conversations?leadId=${input.leadId}`,
      },
    });
  }

  // ------------------------------------------------------------------
  // Onboarding
  // ------------------------------------------------------------------

  async onboardingMilestone(input: { tenantId: string; tenantName?: string; milestone: string }) {
    // Milestones are in-app only (info severity never emails).
    return this.notifications.createForTenant({
      tenantId: input.tenantId,
      eventType: 'onboarding.milestone',
      category: 'onboarding',
      severity: 'info',
      title: `Onboarding: ${input.milestone}`,
      message: `${input.tenantName || 'Client'} completed: ${input.milestone}.`,
      deduplicationKey: `onboarding:milestone:${input.tenantId}:${input.milestone}`,
      actionUrl: '/app/onboarding',
    });
  }

  async onboardingBlocked(input: {
    tenantId: string;
    tenantName?: string;
    blocker: string;
    whatIsNeeded?: string;
  }) {
    const ctx: TemplateContext = {
      tenantName: input.tenantName,
      blocker: input.blocker,
      whatIsNeeded: input.whatIsNeeded,
      actionPath: '/admin/clients',
    };
    const clientRows = await this.notifications.createForTenant({
      tenantId: input.tenantId,
      eventType: 'client.activation_blocked',
      category: 'onboarding',
      severity: 'warning',
      title: 'Activation blocked',
      message: input.blocker,
      deduplicationKey: `onboarding:blocked:${input.tenantId}:${this.dayBucket()}`,
      actionUrl: '/app/onboarding',
      templateId: 'client.activation_blocked',
      templateContext: { ...ctx, actionPath: '/app/onboarding' },
    });
    const adminRows = await this.notifications.createForPlatform({
      eventType: 'client.activation_blocked',
      category: 'onboarding',
      severity: 'warning',
      audience: 'super_admin',
      title: `Activation blocked: ${input.tenantName || input.tenantId}`,
      message: input.blocker,
      deduplicationKey: `onboarding:blocked:admin:${input.tenantId}:${this.dayBucket()}`,
      actionUrl: '/admin/clients',
      templateId: 'client.activation_blocked',
      templateContext: ctx,
    });
    return [...clientRows, ...adminRows];
  }

  async readyForActivation(input: {
    tenantId: string;
    tenantName?: string;
    checklist: {
      billing?: string;
      email?: string;
      crm?: string;
      calendar?: string;
      aiTest?: string;
      backup?: string;
      consent?: string;
    };
  }) {
    const ctx: TemplateContext = {
      tenantName: input.tenantName || input.tenantId,
      actionPath: '/admin/clients',
      ...(input.checklist as Record<string, string>),
    };
    return this.notifications.createForPlatform({
      eventType: 'client.ready_for_activation',
      category: 'onboarding',
      severity: 'success',
      audience: 'super_admin',
      title: `${ctx.tenantName} is ready for activation`,
      message: 'All launch checks passed. Review and activate the workspace.',
      deduplicationKey: `onboarding:ready:${input.tenantId}:${this.dayBucket()}`,
      actionUrl: '/admin/clients',
      templateId: 'client.ready_for_activation',
      templateContext: ctx,
    });
  }

  async clientActivated(input: { tenantId: string; tenantName?: string }) {
    const clientRows = await this.notifications.createForTenant({
      tenantId: input.tenantId,
      eventType: 'client.activated',
      category: 'onboarding',
      severity: 'success',
      title: 'Your workspace is live',
      message: `${input.tenantName || 'Your workspace'} has been activated. Automations are now running.`,
      deduplicationKey: `onboarding:activated:${input.tenantId}:${this.dayBucket()}`,
      actionUrl: '/app/dashboard',
    });
    const adminRows = await this.notifications.createForPlatform({
      eventType: 'client.activated',
      category: 'onboarding',
      severity: 'success',
      audience: 'super_admin',
      title: `Client activated: ${input.tenantName || input.tenantId}`,
      message: `${input.tenantName || input.tenantId} is now live.`,
      deduplicationKey: `onboarding:activated:admin:${input.tenantId}:${this.dayBucket()}`,
      actionUrl: '/admin/clients',
    });
    this.logger.log(
      operationalEvent('client_activated_notification', { tenantId: input.tenantId }),
    );
    return [...clientRows, ...adminRows];
  }
}
