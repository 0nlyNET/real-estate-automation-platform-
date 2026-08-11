import { BadRequestException, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { DurableJobsService } from '../durable-jobs/durable-jobs.service';
import { TenantEmailIdentity } from '../integrations/tenant-email-identity.entity';
import { TenantMessagingResource } from '../integrations/tenant-messaging-resource.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Tenant } from '../tenants/tenant.entity';
import { OffboardingRequest } from './offboarding-request.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class OffboardingService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(OffboardingRequest)
    private readonly requests: Repository<OffboardingRequest>,
    @Optional() private readonly jobs?: DurableJobsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  onModuleInit() {
    if (!this.jobs) return;
    this.jobs.register('offboarding.start', async (job) => {
      if (!job.tenantId) throw new Error('Offboarding job is missing tenantId');
      await this.start(job.tenantId);
    });
    this.jobs.register('offboarding.delete', async (job) => {
      if (!job.tenantId) throw new Error('Offboarding job is missing tenantId');
      await this.deleteRetainedData(job.tenantId);
    });
  }

  async request(input: {
    tenantId: string;
    reason: string;
    requestedById?: string | null;
    retentionDays?: number;
  }) {
    const tenant = await this.dataSource.getRepository(Tenant).findOne({
      where: { id: input.tenantId },
    });
    if (!tenant) throw new BadRequestException('Tenant not found');
    const configured = input.retentionDays ?? Number(process.env.CLIENT_DATA_RETENTION_DAYS || 30);
    if (!Number.isInteger(configured) || configured < 7 || configured > 365) {
      throw new BadRequestException('Retention must be between 7 and 365 days');
    }
    let row = await this.requests.findOne({ where: { tenantId: input.tenantId } });
    row ||= this.requests.create({ tenantId: input.tenantId } as OffboardingRequest);
    row.status = 'scheduled';
    row.reason = String(input.reason || 'service ended').slice(0, 2_000);
    row.requestedById = input.requestedById || null;
    row.retentionDays = configured;
    row.deleteAfter = new Date(Date.now() + configured * 24 * 60 * 60_000);
    row.startedAt = null;
    row.completedAt = null;
    row.lastError = null;
    row = await this.requests.save(row);
    if (this.jobs) {
      await this.jobs.schedule({
        taskType: 'offboarding.start',
        tenantId: input.tenantId,
        dedupeKey: `offboarding.start:${input.tenantId}`,
      });
    } else await this.start(input.tenantId);
    await this.audit?.recordSystemEvent({
      tenantId: input.tenantId,
      eventType: 'tenant.offboarding_requested',
      resourceType: 'offboarding_request',
      resourceId: row.id,
      afterState: { status: row.status, deleteAfter: row.deleteAfter, reason: row.reason },
    });
    return row;
  }

  async start(tenantId: string) {
    const row = await this.requests.findOneOrFail({ where: { tenantId } });
    await this.dataSource.transaction(async (manager) => {
      const tenant = await manager.getRepository(Tenant).findOneOrFail({ where: { id: tenantId } });
      tenant.lifecycleStatus = 'SUSPENDED';
      tenant.servicePausedAt = new Date();
      tenant.serviceSuspendedAt = new Date();
      tenant.serviceSuspensionReason = 'Client offboarding retention period';
      tenant.serviceSuspensionSource = 'billing';
      await manager.save(tenant);
      await manager.getRepository(TenantSettings).update(
        { tenantId },
        { automationsEnabled: false },
      );
      await manager.getRepository(TenantMessagingResource).update(
        { tenantId },
        { smsStatus: 'blocked', lastError: 'Tenant is offboarding' },
      );
      await manager.getRepository(TenantEmailIdentity).update(
        { tenantId },
        { emailStatus: 'blocked', reputationStatus: 'blocked', lastError: 'Tenant is offboarding' },
      );
    });
    row.status = 'retention';
    row.startedAt ||= new Date();
    await this.requests.save(row);
    await this.jobs?.schedule({
      taskType: 'offboarding.delete',
      tenantId,
      dedupeKey: `offboarding.delete:${tenantId}`,
      nextRunAt: row.deleteAfter,
    });
    await this.audit?.recordSystemEvent({
      tenantId,
      eventType: 'tenant.offboarding_started',
      resourceType: 'offboarding_request',
      resourceId: row.id,
      afterState: { status: row.status, deleteAfter: row.deleteAfter },
    });
    return row;
  }

  async export(tenantId: string) {
    const request = await this.requests.findOne({ where: { tenantId } });
    if (request?.status === 'deleted') {
      throw new BadRequestException('Client data retention period has ended');
    }
    const [tenant, leads, messages, appointments, reports] = await Promise.all([
      this.dataSource.query(
        'SELECT id, name, lifecycle_status, created_at FROM tenants WHERE id = $1',
        [tenantId],
      ),
      this.dataSource.query(
        'SELECT id, full_name, email, phone, source, stage, temperature, lead_type, created_at, updated_at FROM leads WHERE tenant_id = $1 ORDER BY created_at',
        [tenantId],
      ),
      this.dataSource.query(
        'SELECT m.id, m."leadId" AS lead_id, m.channel, m.direction, m.body, m.subject, m.status, m.created_at FROM messages m JOIN leads l ON l.id = m."leadId" WHERE l.tenant_id = $1 ORDER BY m.created_at',
        [tenantId],
      ),
      this.dataSource.query(
        'SELECT id, lead_id, starts_at, ends_at, status, source, calendar_source, confirmation_status, notes FROM appointments WHERE tenant_id = $1 ORDER BY starts_at',
        [tenantId],
      ),
      this.dataSource.query(
        'SELECT stage, COUNT(*)::int AS count FROM leads WHERE tenant_id = $1 GROUP BY stage ORDER BY stage',
        [tenantId],
      ),
    ]);
    if (request) {
      request.exportGeneratedAt = new Date();
      await this.requests.save(request);
      await this.audit?.recordSystemEvent({
        tenantId,
        eventType: 'tenant.offboarding_export_generated',
        resourceType: 'offboarding_request',
        resourceId: request.id,
        afterState: { exportGeneratedAt: request.exportGeneratedAt },
      });
    }
    return {
      exportedAt: new Date().toISOString(),
      tenant: tenant[0] || null,
      leads,
      conversationHistory: messages,
      appointments,
      reports: { leadsByStage: reports },
      retention: request
        ? { deleteAfter: request.deleteAfter, status: request.status }
        : null,
    };
  }

  async deleteRetainedData(tenantId: string) {
    const row = await this.requests.findOneOrFail({ where: { tenantId } });
    if (row.deleteAfter > new Date()) {
      throw new Error('Retention period has not ended');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE messages SET body = '[deleted after retention]', subject = NULL,
           provider_message_id = NULL, sanitized_error_message = NULL
         WHERE "leadId" IN (SELECT id FROM leads WHERE tenant_id = $1)`,
        [tenantId],
      );
      await manager.query(
        `UPDATE leads SET full_name = 'Deleted lead ' || RIGHT(id::text, 8),
           email = NULL, phone = NULL, notes = NULL, location = NULL,
           property_interest = NULL, budget_range = NULL,
           estimated_price = NULL, preferred_areas = NULL
         WHERE tenant_id = $1`,
        [tenantId],
      );
      await manager.query(
        `UPDATE appointments SET notes = NULL, external_event_id = NULL,
           assigned_user_id = NULL WHERE tenant_id = $1`,
        [tenantId],
      );
      await manager.query(
        `UPDATE onboarding_records SET business_identity = '{}'::jsonb,
           contacts = '{}'::jsonb, lead_handling = '{}'::jsonb,
           brand_communication = '{}'::jsonb,
           consent_configuration = '{}'::jsonb,
           integration_configuration = '{}'::jsonb
         WHERE tenant_id = $1`,
        [tenantId],
      );
      await manager.query(
        `UPDATE users SET email = 'deleted+' || id::text || '@invalid.local',
           "isActive" = false, "emailVerifyToken" = NULL
         WHERE "tenantId" = $1`,
        [tenantId],
      );
      await manager.query(
        `UPDATE tenants SET name = 'Offboarded ' || RIGHT(id::text, 8),
           lifecycle_status = 'CANCELED'
         WHERE id = $1`,
        [tenantId],
      );
    });
    row.status = 'deleted';
    row.completedAt = new Date();
    row.lastError = null;
    const saved = await this.requests.save(row);
    await this.audit?.recordSystemEvent({
      tenantId,
      eventType: 'tenant.offboarding_retention_deleted',
      resourceType: 'offboarding_request',
      resourceId: saved.id,
      afterState: { status: saved.status, completedAt: saved.completedAt },
    });
    return saved;
  }

  status(tenantId: string) {
    return this.requests.findOne({ where: { tenantId } });
  }
}
