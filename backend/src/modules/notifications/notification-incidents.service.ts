import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { operationalEvent } from '../../common/operational-log';
import { NotificationCategory } from './notification.entity';
import { NotificationIncident } from './notification-incident.entity';
import { NotificationsService } from './notifications.service';
import { TemplateContext } from './notification-templates';

export type IncidentFailureInput = {
  /** Stable deduplication key, e.g. `sendgrid:auth` or `calendar:disconnect:{tenantId}`. */
  incidentKey: string;
  tenantId?: string | null;
  eventType: string;
  category: NotificationCategory;
  title: string;
  message: string;
  /** Forces critical escalation regardless of failure count. */
  platformImpact?: boolean;
  templateId?: string;
  templateContext?: TemplateContext;
  actionUrl?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
};

export type IncidentRecoveryInput = {
  incidentKey: string;
  tenantId?: string | null;
  eventType: string;
  category?: NotificationCategory;
  title: string;
  message: string;
  templateId?: string;
  templateContext?: TemplateContext;
  actionUrl?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
};

const FAILURE_WINDOW_MS = 15 * 60_000;
const WARN_THRESHOLD = 3;
const CRITICAL_THRESHOLD = 5;

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  success: 1,
  warning: 2,
  critical: 3,
};

/**
 * Failure → warn → escalate → single-recovery lifecycle for operational
 * incidents. Thresholds:
 * - 1st failure in window: in-app info notification only, no email
 * - 3 failures within 15 min: WARNING (in-app + email + optional push)
 * - 5 failures within 15 min OR platformImpact: CRITICAL escalation
 * - further failures while open: no additional emails (deduplicated)
 * - severity escalation (warning → critical): one additional notification
 * - recovery: exactly one recovery email when an incident was open
 */
@Injectable()
export class NotificationIncidentsService {
  private readonly logger = new Logger(NotificationIncidentsService.name);

  constructor(
    @InjectRepository(NotificationIncident)
    private readonly incidents: Repository<NotificationIncident>,
    private readonly notifications: NotificationsService,
  ) {}

  async recordFailure(input: IncidentFailureInput): Promise<NotificationIncident> {
    const now = new Date();
    let incident = await this.incidents.findOne({
      where: { incidentKey: input.incidentKey },
    });
    if (!incident) {
      incident = this.incidents.create({
        incidentKey: input.incidentKey,
        status: 'open',
        failureCount: 0,
        metadata: {},
      });
    }
    if (incident.status === 'recovered' || incident.status === 'resolved') {
      // A fresh failure after recovery reopens the incident with a clean count.
      incident.status = 'open';
      incident.failureCount = 0;
      incident.firstFailureAt = null;
      incident.lastNotifiedSeverity = null;
      incident.lastNotifiedAt = null;
      incident.recoveredAt = null;
    }
    // Reset the counting window when the first failure is older than 15 min.
    if (
      incident.firstFailureAt &&
      now.getTime() - incident.firstFailureAt.getTime() > FAILURE_WINDOW_MS
    ) {
      incident.failureCount = 0;
      incident.firstFailureAt = null;
    }
    incident.failureCount += 1;
    incident.firstFailureAt = incident.firstFailureAt || now;
    incident.lastFailureAt = now;
    incident.metadata = { ...(incident.metadata || {}), ...(input.metadata || {}) };

    const targetSeverity =
      input.platformImpact || incident.failureCount >= CRITICAL_THRESHOLD
        ? 'critical'
        : incident.failureCount >= WARN_THRESHOLD
          ? 'warning'
          : 'info';

    const alreadyNotifiedRank = SEVERITY_RANK[incident.lastNotifiedSeverity || ''] ?? -1;
    const targetRank = SEVERITY_RANK[targetSeverity];
    // Notify only on first info (in-app) or when severity strictly escalates.
    const shouldNotify = targetSeverity === 'info'
      ? !incident.lastNotifiedAt
      : targetRank > alreadyNotifiedRank;

    if (shouldNotify) {
      const deduplicationKey = `incident:${input.incidentKey}:${targetSeverity}:${incident.id || 'new'}`;
      const create = {
        eventType: input.eventType,
        category: input.category,
        severity: targetSeverity as 'info' | 'warning' | 'critical',
        title: input.title,
        message: input.message,
        deduplicationKey,
        incidentKey: input.incidentKey,
        actionUrl: input.actionUrl ?? null,
        templateId: input.templateId,
        templateContext: input.templateContext,
        metadata: input.metadata,
      };
      if (input.tenantId) {
        await this.notifications.createForTenant({ ...create, tenantId: input.tenantId });
      } else {
        await this.notifications.createForPlatform(create);
      }
      incident.lastNotifiedSeverity = targetSeverity;
      incident.lastNotifiedAt = now;
      if (targetSeverity === 'critical') incident.status = 'escalated';
    }

    try {
      return await this.incidents.save(incident);
    } catch (error: unknown) {
      this.logger.error(
        operationalEvent('notification_incident_save_failed', {
          incidentKey: input.incidentKey,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return incident;
    }
  }

  /**
   * Marks the incident recovered and sends exactly one recovery notification
   * (success, email + in-app). No-op when no incident is open.
   */
  async recordRecovery(input: IncidentRecoveryInput): Promise<NotificationIncident | null> {
    const incident = await this.incidents.findOne({
      where: { incidentKey: input.incidentKey },
    });
    if (!incident || (incident.status !== 'open' && incident.status !== 'escalated')) {
      return null;
    }
    const now = new Date();
    const create = {
      eventType: input.eventType,
      category: input.category || 'system',
      severity: 'success' as const,
      title: input.title,
      message: input.message,
      deduplicationKey: `incident:${input.incidentKey}:recovered:${now.getTime()}`,
      incidentKey: input.incidentKey,
      actionUrl: input.actionUrl ?? null,
      templateId: input.templateId,
      templateContext: input.templateContext,
      metadata: input.metadata,
    };
    if (input.tenantId) {
      await this.notifications.createForTenant({ ...create, tenantId: input.tenantId });
    } else {
      await this.notifications.createForPlatform(create);
    }
    incident.status = 'recovered';
    incident.recoveredAt = now;
    incident.lastNotifiedSeverity = 'success';
    incident.lastNotifiedAt = now;
    try {
      return await this.incidents.save(incident);
    } catch (error: unknown) {
      this.logger.error(
        operationalEvent('notification_incident_recovery_save_failed', {
          incidentKey: input.incidentKey,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return incident;
    }
  }

  async findOpen(incidentKey: string): Promise<NotificationIncident | null> {
    const incident = await this.incidents.findOne({ where: { incidentKey } });
    if (!incident || (incident.status !== 'open' && incident.status !== 'escalated')) return null;
    return incident;
  }
}
