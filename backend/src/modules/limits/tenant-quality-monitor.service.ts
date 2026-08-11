import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { operationalEvent } from '../../common/operational-log';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationsService } from '../operations/operations.service';
import { ServiceControlService } from '../service-control/service-control.service';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Tenant } from '../tenants/tenant.entity';

type QualitySeverity = 'healthy' | 'warning' | 'serious' | 'extreme';

export type TenantQualityReport = {
  tenantId: string;
  severity: QualitySeverity;
  reasons: string[];
  metrics: {
    smsAttempts: number;
    smsFailures: number;
    smsLastHour: number;
    emailAttempts: number;
    emailBounces: number;
    emailLastHour: number;
    spamComplaints: number;
    optOuts: number;
    leadsLastHour: number;
    prohibitedContentBlocks: number;
  };
};

@Injectable()
export class TenantQualityMonitorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TenantQualityMonitorService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly operations: OperationsService,
    private readonly serviceControl: ServiceControlService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.checkActiveTenants().catch((error: unknown) =>
        this.logger.error(
          operationalEvent('tenant_quality_monitor_failed', {
            error: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
    }, 5 * 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async checkActiveTenants(now = new Date()) {
    const tenants = await this.dataSource.getRepository(Tenant).find({
      where: { lifecycleStatus: 'ACTIVE' },
      select: { id: true },
    });
    const reports: TenantQualityReport[] = [];
    for (const tenant of tenants) {
      const report = await this.evaluateTenant(tenant.id, now);
      reports.push(report);
      await this.applyReport(report, now);
    }
    return reports;
  }

  async evaluateTenant(tenantId: string, now = new Date()) {
    const sinceDay = new Date(now.getTime() - 24 * 60 * 60_000);
    const sinceHour = new Date(now.getTime() - 60 * 60_000);
    const [messageRows, emailRows, optOutRows, leadRows, prohibitedRows] =
      await Promise.all([
      this.dataSource.query(
        `SELECT channel,
                COUNT(*)::int AS attempts,
                COUNT(*) FILTER (WHERE status = 'failed')::int AS failures,
                COUNT(*) FILTER (WHERE created_at >= $3)::int AS last_hour
         FROM messages
         WHERE direction = 'outbound'
           AND created_at >= $2
           AND status IN ('provider_accepted', 'sent', 'delivered', 'failed')
           AND "leadId" IN (SELECT id FROM leads WHERE tenant_id = $1)
         GROUP BY channel`,
        [tenantId, sinceDay, sinceHour],
      ),
      this.dataSource.query(
        `SELECT
           COUNT(*) FILTER (WHERE event_type IN ('bounce', 'blocked', 'dropped'))::int AS bounces,
           COUNT(*) FILTER (WHERE event_type IN ('spamreport', 'spam_report'))::int AS complaints
         FROM sendgrid_webhook_events
         WHERE tenant_id = $1 AND created_at >= $2`,
        [tenantId, sinceDay],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS count
         FROM compliance_optouts
         WHERE "tenantId" = $1 AND "createdAt" >= $2`,
        [tenantId, sinceDay],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS count
         FROM leads
         WHERE tenant_id = $1 AND created_at >= $2`,
        [tenantId, sinceHour],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS count
         FROM ai_runs
         WHERE tenant_id = $1
           AND created_at >= $2
           AND status = 'blocked'
           AND error_code IN ('FAIR_HOUSING', 'PROHIBITED_CONTENT', 'WORKSPACE_PROHIBITED_TOPIC')`,
        [tenantId, sinceDay],
      ),
    ]);
    const channel = (name: string) =>
      messageRows.find((row: any) => row.channel === name) || {
        attempts: 0,
        failures: 0,
      };
    const sms = channel('sms');
    const email = channel('email');
    const metrics = {
      smsAttempts: Number(sms.attempts || 0),
      smsFailures: Number(sms.failures || 0),
      smsLastHour: Number(sms.last_hour || 0),
      emailAttempts: Number(email.attempts || 0),
      emailBounces: Number(emailRows[0]?.bounces || 0),
      emailLastHour: Number(email.last_hour || 0),
      spamComplaints: Number(emailRows[0]?.complaints || 0),
      optOuts: Number(optOutRows[0]?.count || 0),
      leadsLastHour: Number(leadRows[0]?.count || 0),
      prohibitedContentBlocks: Number(prohibitedRows[0]?.count || 0),
    };
    return this.classify(tenantId, metrics);
  }

  classify(
    tenantId: string,
    metrics: TenantQualityReport['metrics'],
  ): TenantQualityReport {
    const smsFailureRate = metrics.smsAttempts
      ? metrics.smsFailures / metrics.smsAttempts
      : 0;
    const emailBounceRate = metrics.emailAttempts
      ? metrics.emailBounces / metrics.emailAttempts
      : 0;
    const optOutRate = metrics.smsAttempts + metrics.emailAttempts
      ? metrics.optOuts / (metrics.smsAttempts + metrics.emailAttempts)
      : 0;
    const reasons: string[] = [];
    let severity: QualitySeverity = 'healthy';
    const raise = (next: QualitySeverity, reason: string) => {
      const rank: Record<QualitySeverity, number> = {
        healthy: 0,
        warning: 1,
        serious: 2,
        extreme: 3,
      };
      if (rank[next] > rank[severity]) severity = next;
      reasons.push(reason);
    };

    if (metrics.smsAttempts >= 20 && smsFailureRate >= 0.1) {
      raise(
        smsFailureRate >= 0.35 ? 'extreme' : smsFailureRate >= 0.2 ? 'serious' : 'warning',
        `SMS failure rate is ${(smsFailureRate * 100).toFixed(1)}%`,
      );
    }
    if (metrics.emailAttempts >= 20 && emailBounceRate >= 0.02) {
      raise(
        emailBounceRate >= 0.1 ? 'extreme' : emailBounceRate >= 0.05 ? 'serious' : 'warning',
        `Email bounce/drop rate is ${(emailBounceRate * 100).toFixed(1)}%`,
      );
    }
    if (metrics.spamComplaints > 0) {
      raise(
        metrics.spamComplaints >= 3 ? 'extreme' : 'serious',
        `${metrics.spamComplaints} spam complaint(s) were reported`,
      );
    }
    if (
      metrics.smsAttempts + metrics.emailAttempts >= 20 &&
      optOutRate >= 0.05
    ) {
      raise(
        optOutRate >= 0.15 ? 'extreme' : optOutRate >= 0.1 ? 'serious' : 'warning',
        `Opt-out rate is ${(optOutRate * 100).toFixed(1)}%`,
      );
    }
    const sendsLastHour = metrics.smsLastHour + metrics.emailLastHour;
    if (sendsLastHour >= 100) {
      raise(
        sendsLastHour >= 500
          ? 'extreme'
          : sendsLastHour >= 250
            ? 'serious'
            : 'warning',
        `Send velocity is ${sendsLastHour} messages in the last hour`,
      );
    }
    if (metrics.leadsLastHour >= 100) {
      raise(
        metrics.leadsLastHour >= 500
          ? 'extreme'
          : metrics.leadsLastHour >= 250
            ? 'serious'
            : 'warning',
        `Lead volume is ${metrics.leadsLastHour} in the last hour`,
      );
    }
    if (metrics.prohibitedContentBlocks >= 2) {
      raise(
        metrics.prohibitedContentBlocks >= 10
          ? 'extreme'
          : metrics.prohibitedContentBlocks >= 5
            ? 'serious'
            : 'warning',
        `${metrics.prohibitedContentBlocks} prohibited-content responses were blocked`,
      );
    }
    return { tenantId, severity, reasons, metrics };
  }

  private async applyReport(report: TenantQualityReport, now: Date) {
    if (report.severity === 'healthy') return;
    const period = now.toISOString().slice(0, 10);
    await Promise.all([
      this.notifications.createForTenant({
        tenantId: report.tenantId,
        eventType: 'quality.threshold_warning',
        category: 'system',
        severity: report.severity === 'warning' ? 'warning' : 'critical',
        title: 'Messaging quality needs attention',
        message: report.reasons.join('; '),
        deduplicationKey: `quality-tenant:${report.tenantId}:${report.severity}:${period}`,
        incidentKey: `quality:${report.tenantId}`,
        actionUrl: '/app/dashboard',
        entityType: 'tenant',
        entityId: report.tenantId,
      }),
      this.notifications.createForPlatform({
        eventType: 'quality.threshold_warning',
        category: 'system',
        severity: report.severity === 'warning' ? 'warning' : 'critical',
        audience: 'super_admin',
        title: 'Client messaging quality needs attention',
        message: report.reasons.join('; '),
        deduplicationKey: `quality-owner:${report.tenantId}:${report.severity}:${period}`,
        incidentKey: `quality:${report.tenantId}`,
        actionUrl: `/admin/dashboard?view=clients&tenantId=${report.tenantId}`,
        entityType: 'tenant',
        entityId: report.tenantId,
      }),
    ]);
    if (report.severity === 'warning') return;

    if (report.severity === 'extreme') {
      await this.serviceControl.suspend({
        tenantId: report.tenantId,
        reason: `Automated quality protection: ${report.reasons.join('; ')}`,
        source: 'safety',
        actor: {
          id: '00000000-0000-0000-0000-000000000000',
          email: 'system@realtytechai.app',
        },
        auditPath: '/system/quality-monitor',
      });
    } else {
      await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `service-control:${report.tenantId}`,
        ]);
        const settingsRepo = manager.getRepository(TenantSettings);
        let settings = await settingsRepo.findOne({
          where: { tenantId: report.tenantId },
        });
        if (!settings) settings = settingsRepo.create({ tenantId: report.tenantId });
        settings.automationsEnabled = false;
        await settingsRepo.save(settings);
        const tenantRepo = manager.getRepository(Tenant);
        const tenant = await tenantRepo.findOne({ where: { id: report.tenantId } });
        if (tenant?.lifecycleStatus === 'ACTIVE') {
          tenant.lifecycleStatus = 'PAUSED';
          tenant.servicePausedAt = new Date();
          await tenantRepo.save(tenant);
        }
      });
    }
    await this.operations.createTask({
      tenantId: report.tenantId,
      category: 'client_quality',
      title:
        report.severity === 'extreme'
          ? 'Client suspended by quality protection'
          : 'Client automation paused by quality protection',
      description: `${report.reasons.join('; ')}. Review consent sources, list quality, sending behavior, and provider evidence before restoring service.`,
      priority: 'critical',
      relatedEntityType: 'tenant',
      relatedEntityId: report.tenantId,
      dedupeOpen: true,
    });
    await this.audit.recordSystemEvent({
      tenantId: report.tenantId,
      eventType:
        report.severity === 'extreme'
          ? 'tenant.suspended_quality'
          : 'automation.paused_quality',
      resourceType: 'tenant',
      resourceId: report.tenantId,
      afterState: {
        severity: report.severity,
        reasons: report.reasons,
        metrics: report.metrics,
      },
    });
  }
}
