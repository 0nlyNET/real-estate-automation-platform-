import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { operationalEvent } from '../../common/operational-log';
import { AuditService } from '../audit/audit.service';
import { billingEligibility } from '../entitlements/entitlement.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OnboardingRecord } from '../onboarding/onboarding-record.entity';
import { OperationsTask } from '../operations/operations-task.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Tenant } from '../tenants/tenant.entity';

export type ServiceSuspensionSource = 'manual' | 'billing';

export type ServiceControlActor = {
  id: string;
  email?: string | null;
};

export type ServiceState =
  | 'active'
  | 'payment_overdue'
  | 'grace_period'
  | 'suspended'
  | 'paused'
  | 'onboarding'
  | 'canceled';

export function describeServiceState(tenant: Tenant, now = new Date()) {
  if (tenant.lifecycleStatus === 'SUSPENDED') {
    return {
      state: 'suspended' as ServiceState,
      label: 'Services suspended',
      reason: tenant.serviceSuspensionReason || 'Services have been stopped by RealtyTechAI.',
      graceEndsAt: null,
    };
  }
  if (tenant.lifecycleStatus === 'CANCELED' || tenant.status === 'canceled') {
    return {
      state: 'canceled' as ServiceState,
      label: 'Service ended',
      reason: 'The subscription is no longer active.',
      graceEndsAt: null,
    };
  }
  if (tenant.status === 'past_due') {
    const eligibility = billingEligibility(tenant, now);
    if (eligibility.allowed && eligibility.graceEndsAt) {
      return {
        state: 'grace_period' as ServiceState,
        label: 'Payment overdue — grace period',
        reason: 'Payment needs attention before the grace period ends.',
        graceEndsAt: eligibility.graceEndsAt.toISOString(),
      };
    }
    return {
      state: 'payment_overdue' as ServiceState,
      label: 'Payment overdue',
      reason: eligibility.reason || 'Payment is past due.',
      graceEndsAt: eligibility.graceEndsAt?.toISOString() || null,
    };
  }
  if (tenant.lifecycleStatus === 'PAUSED') {
    return {
      state: 'paused' as ServiceState,
      label: 'Service paused',
      reason: 'Automation is currently paused.',
      graceEndsAt: null,
    };
  }
  if (tenant.lifecycleStatus !== 'ACTIVE') {
    return {
      state: 'onboarding' as ServiceState,
      label: 'Onboarding',
      reason: 'Service has not been activated yet.',
      graceEndsAt: null,
    };
  }
  return {
    state: 'active' as ServiceState,
    label: 'Active',
    reason: 'RealtyTechAI services are active.',
    graceEndsAt: null,
  };
}

@Injectable()
export class ServiceControlService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServiceControlService.name);
  private monitor?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.monitor = setInterval(() => {
      this.suspendExpiredBillingGrace().catch((error: unknown) => {
        this.logger.error(
          operationalEvent('billing_suspension_monitor_failed', {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    }, 5 * 60_000);
    this.monitor.unref?.();
  }

  onModuleDestroy() {
    if (this.monitor) clearInterval(this.monitor);
  }

  async status(tenantId: string) {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Workspace not found');
    return {
      ...describeServiceState(tenant),
      lifecycleStatus: tenant.lifecycleStatus,
      billingStatus: tenant.status,
      suspendedAt: tenant.serviceSuspendedAt || null,
      suspensionReason: tenant.serviceSuspensionReason || null,
      suspensionSource: tenant.serviceSuspensionSource || null,
      suspendedById: tenant.serviceSuspendedById || null,
      restoredAt: tenant.serviceRestoredAt || null,
      restoredById: tenant.serviceRestoredById || null,
    };
  }

  async suspend(input: {
    tenantId: string;
    reason: string;
    internalNote?: string;
    source: ServiceSuspensionSource;
    actor?: ServiceControlActor | null;
    requestCorrelationId?: string;
    auditPath?: string;
  }) {
    const reason = String(input.reason || '').trim().slice(0, 1000);
    if (reason.length < 3) throw new BadRequestException('A suspension reason is required');

    const result = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `service-control:${input.tenantId}`,
      ]);
      const tenantRepo = manager.getRepository(Tenant);
      const tenant = await tenantRepo.findOne({
        where: { id: input.tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tenant) throw new NotFoundException('Workspace not found');

      if (tenant.lifecycleStatus === 'SUSPENDED' && tenant.serviceSuspendedAt) {
        return {
          changed: false,
          tenant,
          previousState: tenant.lifecycleStatus,
          stoppedEnrollments: 0,
          canceledMessages: 0,
        };
      }

      const suspendedAt = new Date();
      const previousState = tenant.lifecycleStatus;
      tenant.servicePreviousLifecycleStatus = tenant.lifecycleStatus;
      tenant.lifecycleStatus = 'SUSPENDED';
      tenant.servicePausedAt = suspendedAt;
      tenant.serviceSuspendedAt = suspendedAt;
      tenant.serviceSuspensionReason = reason;
      tenant.serviceSuspensionSource = input.source;
      tenant.serviceSuspendedById = input.actor?.id || null;
      tenant.serviceRestoredAt = null;
      tenant.serviceRestoredById = null;
      await tenantRepo.save(tenant);

      const settingsRepo = manager.getRepository(TenantSettings);
      let settings = await settingsRepo.findOne({ where: { tenantId: input.tenantId } });
      if (!settings) settings = settingsRepo.create({ tenantId: input.tenantId });
      settings.automationsEnabled = false;
      await settingsRepo.save(settings);

      const stopped: Array<{ id: string }> = await manager.query(
        `UPDATE sequence_enrollments
         SET status = 'stopped',
             stopped_reason = 'service_suspended',
             locked_at = NULL,
             locked_by = NULL
         WHERE tenant_id = $1
           AND status IN ('active', 'paused')
         RETURNING id`,
        [input.tenantId],
      );

      await manager.query(
        `UPDATE leads
         SET sequence_status = 'stopped'
         WHERE tenant_id = $1
           AND EXISTS (
             SELECT 1
             FROM sequence_enrollments enrollment
             WHERE enrollment."leadId" = leads.id
               AND enrollment.tenant_id = $1
               AND enrollment.stopped_reason = 'service_suspended'
           )`,
        [input.tenantId],
      );

      const blocked: Array<{ id: string }> = await manager.query(
        `UPDATE messages
         SET status = 'blocked',
             blocked_at = now(),
             blocked_reason = 'Client services are suspended',
             blocked_reason_history = COALESCE(blocked_reason_history, '[]'::jsonb) ||
               jsonb_build_array(jsonb_build_object(
                 'reason', 'Client services are suspended',
                 'ruleIds', jsonb_build_array('CLIENT_SUSPENDED'),
                 'blockedAt', now()
               )),
             safety_rule_ids = jsonb_build_array('CLIENT_SUSPENDED'),
             error_code = 'CLIENT_SUSPENDED',
             sanitized_error_message = 'Client services are suspended',
             last_error = 'Client services are suspended',
             locked_at = NULL,
             locked_by = NULL,
             next_attempt_at = NULL
         WHERE direction = 'outbound'
           AND status IN ('created', 'queued', 'pending', 'scheduled', 'sending')
           AND (status <> 'sending' OR provider_submission_started_at IS NULL)
           AND "leadId" IN (
             SELECT id FROM leads WHERE tenant_id = $1
           )
         RETURNING id`,
        [input.tenantId],
      );

      await manager.getRepository(OnboardingRecord).update(
        { tenantId: input.tenantId },
        {
          activationStatus: 'paused',
          blockedReason: reason,
        },
      );
      const taskRepo = manager.getRepository(OperationsTask);
      const openTask = await taskRepo.findOne({
        where: ['open', 'in_progress', 'blocked'].map((status) => ({
          category: 'service_suspension',
          relatedEntityType: 'tenant',
          relatedEntityId: input.tenantId,
          status: status as OperationsTask['status'],
        })),
      });
      if (!openTask) {
        await taskRepo.save(
          taskRepo.create({
            tenantId: input.tenantId,
            category: 'service_suspension',
            title: 'Client services are suspended',
            description: `${reason} Restore service only after billing and account status are confirmed.`,
            priority: 'high',
            status: 'open',
            relatedEntityType: 'tenant',
            relatedEntityId: input.tenantId,
          }),
        );
      }

      await this.audit.record(
        {
          tenantId: input.tenantId,
          actorId: input.actor?.id || input.tenantId,
          actorEmail: input.actor?.email || null,
          action: 'client.services.suspended',
          method: input.source === 'billing' ? 'EVENT' : 'POST',
          path:
            input.auditPath ||
            (input.source === 'billing'
              ? '/billing/service-suspension'
              : `/admin/tenants/${input.tenantId}/suspend`),
          statusCode: 200,
          metadata: {
            source: input.source,
            reason,
            internalNote: input.internalNote?.trim().slice(0, 2000) || null,
            previousState,
            newState: tenant.lifecycleStatus,
            requestCorrelationId: input.requestCorrelationId || null,
            stoppedEnrollments: stopped.length,
            blockedMessages: blocked.length,
            canceledMessages: blocked.length,
          },
        },
        manager,
      );

      return {
        changed: true,
        tenant,
        previousState,
        stoppedEnrollments: stopped.length,
        canceledMessages: blocked.length,
      };
    });

    const suspendedAt =
      result.tenant.serviceSuspendedAt?.toISOString() || new Date().toISOString();
    const dedupe = `service-suspended:${input.tenantId}:${suspendedAt}`;

    await Promise.all([
      this.notifications.createForPlatform({
        eventType: 'client.services_suspended',
        category: 'clients',
        severity: 'warning',
        audience: 'super_admin',
        title: 'Client services suspended',
        message: `${result.tenant.name || 'A client'}: ${reason}`,
        deduplicationKey: dedupe,
        actionUrl: `/admin/dashboard?view=onboarding&tenantId=${input.tenantId}`,
        entityType: 'tenant',
        entityId: input.tenantId,
      }),
      this.notifications.createForTenant({
        tenantId: input.tenantId,
        eventType: 'service.suspended',
        category: 'billing',
        severity: 'warning',
        title: 'RealtyTechAI services are suspended',
        message: reason,
        deduplicationKey: dedupe,
        actionUrl: '/app/billing',
        entityType: 'tenant',
        entityId: input.tenantId,
      }),
    ]);

    return {
      changed: result.changed,
      clientId: input.tenantId,
      previousState: result.previousState,
      lifecycleStatus: result.tenant.lifecycleStatus,
      suspendedAt: result.tenant.serviceSuspendedAt,
      reason: result.tenant.serviceSuspensionReason,
      source: result.tenant.serviceSuspensionSource,
      stoppedEnrollments: result.stoppedEnrollments,
      blockedMessages: result.canceledMessages,
      canceledMessages: result.canceledMessages,
    };
  }

  async restore(input: {
    tenantId: string;
    actor: ServiceControlActor;
  }) {
    const result = await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `service-control:${input.tenantId}`,
      ]);
      const tenantRepo = manager.getRepository(Tenant);
      const tenant = await tenantRepo.findOne({ where: { id: input.tenantId } });
      if (!tenant) throw new NotFoundException('Workspace not found');

      if (tenant.lifecycleStatus !== 'SUSPENDED') {
        return { changed: false, tenant, restoredEnrollments: 0 };
      }
      const paymentConfirmed =
        tenant.status === 'active' ||
        (tenant.status === 'trialing' &&
          Boolean(tenant.trialEndsAt && tenant.trialEndsAt > new Date()));
      if (!paymentConfirmed) {
        throw new BadRequestException(
          'Payment must be confirmed by Stripe before services can be restored',
        );
      }

      const previous = tenant.servicePreviousLifecycleStatus;
      const restoreToActive = previous === 'ACTIVE';
      tenant.lifecycleStatus = restoreToActive ? 'ACTIVE' : 'PAUSED';
      tenant.servicePausedAt = restoreToActive ? null : tenant.servicePausedAt;
      tenant.serviceRestoredAt = new Date();
      tenant.serviceRestoredById = input.actor.id;
      tenant.servicePreviousLifecycleStatus = null;
      await tenantRepo.save(tenant);

      const settingsRepo = manager.getRepository(TenantSettings);
      let settings = await settingsRepo.findOne({ where: { tenantId: input.tenantId } });
      if (!settings) settings = settingsRepo.create({ tenantId: input.tenantId });
      settings.automationsEnabled = restoreToActive;
      await settingsRepo.save(settings);

      let restored: Array<{ id: string }> = [];
      if (restoreToActive) {
        restored = await manager.query(
          `UPDATE sequence_enrollments enrollment
           SET status = 'active',
               stopped_reason = NULL,
               next_run_at = GREATEST(
                 COALESCE(next_run_at, now() + interval '5 minutes'),
                 now() + interval '5 minutes'
               ),
               locked_at = NULL,
               locked_by = NULL
           WHERE enrollment.tenant_id = $1
             AND enrollment.status = 'stopped'
             AND enrollment.stopped_reason = 'service_suspended'
             AND EXISTS (
               SELECT 1
               FROM leads
               WHERE leads.id = enrollment."leadId"
                 AND leads.tenant_id = $1
                 AND leads.stage NOT IN ('closed', 'lost')
             )
           RETURNING enrollment.id`,
          [input.tenantId],
        );
        await manager.query(
          `UPDATE leads
           SET sequence_status = 'active'
           WHERE tenant_id = $1
             AND stage NOT IN ('closed', 'lost')
             AND EXISTS (
               SELECT 1
               FROM sequence_enrollments enrollment
               WHERE enrollment."leadId" = leads.id
                 AND enrollment.tenant_id = $1
                 AND enrollment.status = 'active'
             )`,
          [input.tenantId],
        );
      }

      await manager.getRepository(OnboardingRecord).update(
        { tenantId: input.tenantId },
        {
          activationStatus: restoreToActive ? 'active' : 'paused',
          blockedReason: null,
        },
      );
      await manager.getRepository(OperationsTask).update(
        {
          category: 'service_suspension',
          relatedEntityType: 'tenant',
          relatedEntityId: input.tenantId,
          status: In(['open', 'in_progress', 'blocked']),
        },
        {
          status: 'resolved',
          completedAt: new Date(),
          evidenceNote: 'Services restored after billing confirmation.',
        },
      );

      return {
        changed: true,
        tenant,
        restoredEnrollments: restored.length,
      };
    });

    if (!result.changed) {
      return {
        changed: false,
        lifecycleStatus: result.tenant.lifecycleStatus,
        restoredAt: result.tenant.serviceRestoredAt,
        restoredEnrollments: 0,
      };
    }

    const restoredAt =
      result.tenant.serviceRestoredAt?.toISOString() || new Date().toISOString();
    const dedupe = `service-restored:${input.tenantId}:${restoredAt}`;
    await Promise.all([
      this.notifications.createForPlatform({
        eventType: 'client.services_restored',
        category: 'clients',
        severity: 'success',
        audience: 'super_admin',
        title: 'Client services restored',
        message: `${result.tenant.name || 'A client'} is ${result.tenant.lifecycleStatus === 'ACTIVE' ? 'active again' : 'ready for review'}.`,
        deduplicationKey: dedupe,
        actionUrl: `/admin/dashboard?view=onboarding&tenantId=${input.tenantId}`,
        entityType: 'tenant',
        entityId: input.tenantId,
      }),
      this.notifications.createForTenant({
        tenantId: input.tenantId,
        eventType: 'service.restored',
        category: 'billing',
        severity: 'success',
        title: 'RealtyTechAI services restored',
        message:
          result.tenant.lifecycleStatus === 'ACTIVE'
            ? 'Your automated services are active again.'
            : 'Your account is available and awaiting service activation.',
        deduplicationKey: dedupe,
        actionUrl: '/app/dashboard',
        entityType: 'tenant',
        entityId: input.tenantId,
      }),
    ]);

    if (result.changed) {
      await this.audit.record({
        tenantId: input.tenantId,
        actorId: input.actor.id,
        actorEmail: input.actor.email || null,
        action: 'client.services.restored',
        method: 'POST',
        path: `/admin/tenants/${input.tenantId}/restore`,
        statusCode: 200,
        metadata: {
          lifecycleStatus: result.tenant.lifecycleStatus,
          restoredEnrollments: result.restoredEnrollments,
        },
      });
    }

    return {
      changed: result.changed,
      lifecycleStatus: result.tenant.lifecycleStatus,
      restoredAt: result.tenant.serviceRestoredAt,
      restoredEnrollments: result.restoredEnrollments,
    };
  }

  async suspendExpiredBillingGrace(now = new Date()) {
    const candidates = await this.tenants
      .createQueryBuilder('tenant')
      .where('tenant.lifecycleStatus != :suspended', { suspended: 'SUSPENDED' })
      .andWhere('tenant.status IN (:...statuses)', {
        statuses: ['past_due', 'unpaid'],
      })
      .take(100)
      .getMany();
    let suspended = 0;
    for (const tenant of candidates) {
      const eligibility = billingEligibility(tenant, now);
      if (tenant.status !== 'unpaid' && eligibility.allowed) continue;
      const result = await this.suspend({
        tenantId: tenant.id,
        source: 'billing',
        reason:
          tenant.status === 'unpaid'
            ? 'Stripe confirmed that the subscription is unpaid.'
            : 'The Stripe-confirmed payment grace period ended without successful payment.',
      });
      if (result.changed) suspended += 1;
    }
    return { checked: candidates.length, suspended };
  }
}
