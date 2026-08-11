import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { environmentReadiness } from '../../common/environment-readiness';
import { operationalEvent } from '../../common/operational-log';
import { StripeWebhookEvent } from '../billing/stripe-webhook-event.entity';
import { NotificationsService } from './notifications.service';
import { Message } from '../messaging/message.entity';
import { SequenceEnrollment } from '../sequences/sequence-enrollment.entity';
import { AiRun } from '../ai/ai-run.entity';
import { TenantMessagingResource } from '../integrations/tenant-messaging-resource.entity';
import { TenantEmailIdentity } from '../integrations/tenant-email-identity.entity';
import { OperationsTask } from '../operations/operations-task.entity';

@Injectable()
export class HealthMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthMonitorService.name);
  private timer?: NodeJS.Timeout;
  private failures = 0;
  private incidentOpen = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(StripeWebhookEvent)
    private readonly stripeEvents: Repository<StripeWebhookEvent>,
    private readonly notifications: NotificationsService,
    @Optional() @InjectRepository(Message)
    private readonly messages?: Repository<Message>,
    @Optional() @InjectRepository(SequenceEnrollment)
    private readonly enrollments?: Repository<SequenceEnrollment>,
    @Optional() @InjectRepository(AiRun)
    private readonly aiRuns?: Repository<AiRun>,
    @Optional() @InjectRepository(TenantMessagingResource)
    private readonly messagingResources?: Repository<TenantMessagingResource>,
    @Optional() @InjectRepository(TenantEmailIdentity)
    private readonly emailIdentities?: Repository<TenantEmailIdentity>,
    @Optional() @InjectRepository(OperationsTask)
    private readonly operationsTasks?: Repository<OperationsTask>,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV !== 'test') {
      this.timer = setInterval(() => void this.check().catch(() => undefined), 5 * 60 * 1000);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async check(now = new Date()) {
    let healthy = true;
    const reasons: string[] = [];
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      healthy = false;
      reasons.push('database check failed');
    }
    const report = environmentReadiness();
    if (report.platform.status === 'down' || report.encryption.status === 'down') {
      healthy = false;
      reasons.push('critical environment configuration is incomplete');
    }
    try {
      const recentFailures = await this.stripeEvents.count({
        where: {
          processingStatus: 'failed',
          createdAt: MoreThan(new Date(now.getTime() - 15 * 60 * 1000)),
        },
      });
      if (recentFailures >= 3) {
        healthy = false;
        reasons.push(`${recentFailures} Stripe webhooks failed in 15 minutes`);
      }
    } catch {
      healthy = false;
      reasons.push('webhook health query failed');
    }
    try {
      const stalledBefore = new Date(now.getTime() - 15 * 60 * 1_000);
      const [stalledMessages, stalledSequences, stalledAi, failedTwilio, failedEmail, criticalIncidents] =
        await Promise.all([
          this.messages?.count({ where: { status: 'sending', lockedAt: LessThan(stalledBefore) } }) || 0,
          this.enrollments?.count({ where: { status: 'active', lockedAt: LessThan(stalledBefore) } }) || 0,
          this.aiRuns?.count({ where: { status: 'processing', lockedAt: LessThan(stalledBefore) } }) || 0,
          this.messagingResources?.count({ where: { smsStatus: In(['failed', 'blocked']) } }) || 0,
          this.emailIdentities?.count({ where: { emailStatus: In(['failed', 'blocked']) } }) || 0,
          this.operationsTasks?.count({
            where: { priority: 'critical', status: Not('resolved') },
          }) || 0,
        ]);
      if (stalledMessages) reasons.push(`${stalledMessages} messages have stalled leases`);
      if (stalledSequences) reasons.push(`${stalledSequences} sequences have stalled leases`);
      if (stalledAi) reasons.push(`${stalledAi} AI jobs have stalled leases`);
      if (failedTwilio) reasons.push(`${failedTwilio} tenant Twilio resources need attention`);
      if (failedEmail) reasons.push(`${failedEmail} tenant email identities need attention`);
      if (criticalIncidents) reasons.push(`${criticalIncidents} critical incidents remain unresolved`);
      if (
        stalledMessages || stalledSequences || stalledAi || failedTwilio ||
        failedEmail || criticalIncidents
      ) healthy = false;
    } catch {
      healthy = false;
      reasons.push('worker/provider health query failed');
    }

    if (!healthy) this.failures += 1;
    else this.failures = 0;

    if (!healthy && this.failures >= 3 && !this.incidentOpen) {
      this.incidentOpen = await this.notifications.incidentIsOpen('system-health');
    }
    if (!healthy && this.failures >= 3 && !this.incidentOpen) {
      this.incidentOpen = true;
      await this.notifications.createForPlatform({
        eventType: 'system.health_incident',
        category: 'system',
        severity: 'critical',
        audience: 'super_admin',
        title: 'RealtyTechAI health incident confirmed',
        message: `${reasons.join('; ')}. Review system health and provider logs.`,
        deduplicationKey: `system-health:${now.toISOString().slice(0, 13)}`,
        incidentKey: 'system-health',
        actionUrl: '/admin/dashboard?view=billing',
      });
    } else if (healthy && !this.incidentOpen) {
      this.incidentOpen = await this.notifications.incidentIsOpen('system-health');
    }
    if (healthy && this.incidentOpen) {
      this.incidentOpen = false;
      await this.notifications.createForPlatform({
        eventType: 'system.health_recovered',
        category: 'system',
        severity: 'success',
        audience: 'super_admin',
        title: 'RealtyTechAI health recovered',
        message: 'The monitored database, configuration, and webhook checks are healthy again.',
        deduplicationKey: `system-health-recovery:${now.toISOString()}`,
        incidentKey: 'system-health',
        actionUrl: '/admin/dashboard?view=billing',
      });
    }
    this.logger.debug(operationalEvent('health_monitor_check', { healthy, reasons }));
    return { healthy, reasons, consecutiveFailures: this.failures, incidentOpen: this.incidentOpen };
  }
}
