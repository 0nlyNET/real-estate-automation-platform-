import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EmailIdentityService } from './email-identity.service';
import { PlatformIntegrationsService } from './platform-integrations.service';
import { TwilioProvisioningService } from './twilio-provisioning.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Credential } from '../settings/credential.entity';
import { Tenant, TenantProvisioningStatus } from '../tenants/tenant.entity';
import { OnboardingService } from '../onboarding/onboarding.service';
import { OperationsService } from '../operations/operations.service';
import { sanitizeOperationalText } from '../../common/operational-log';

@Injectable()
export class TenantProvisioningService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenantProvisioningService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly twilio: TwilioProvisioningService,
    private readonly email: EmailIdentityService,
    private readonly integrations: PlatformIntegrationsService,
    @InjectRepository(Credential)
    private readonly legacyCredentials: Repository<Credential>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly onboarding: OnboardingService,
    private readonly operations: OperationsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV !== 'test') {
      this.timer = setInterval(
        () => void this.reconcilePendingTenants().catch(() => undefined),
        15 * 60 * 1_000,
      );
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async saveState(
    tenant: Tenant,
    status: TenantProvisioningStatus,
    error: string | null = null,
  ) {
    tenant.provisioningStatus = status;
    tenant.provisioningLastReconciledAt = new Date();
    tenant.provisioningLastError = error;
    await this.tenants.save(tenant);
  }

  private async reconcilePendingTenants() {
    const candidates = await this.tenants
      .createQueryBuilder('tenant')
      .where("COALESCE(tenant.provisioning_status, 'WAITING_FOR_CLIENT') NOT IN (:...settled)", {
        settled: ['COMPLIANCE_PENDING', 'READY', 'ACTIVE'],
      })
      .andWhere(
        '(tenant.provisioning_last_reconciled_at IS NULL OR tenant.provisioning_last_reconciled_at < :cutoff)',
        { cutoff: new Date(Date.now() - 15 * 60 * 1_000) },
      )
      .orderBy('tenant.provisioning_last_reconciled_at', 'ASC', 'NULLS FIRST')
      .take(50)
      .getMany();
    for (const tenant of candidates) {
      await this.reconcileTenantProvisioning(tenant.id).catch((error) => {
        this.logger.warn(`Tenant provisioning retry failed for ${tenant.id}: ${sanitizeOperationalText(error?.message || error)}`);
      });
    }
  }

  async reconcileTenantProvisioning(tenantId: string) {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new Error('Workspace not found');
    const before = await this.onboarding.readiness(tenantId);
    const profileReady = !before.blockers.some(
      (item: any) => item.category === 'client_information',
    );
    if (!profileReady) {
      await this.saveState(tenant, 'WAITING_FOR_CLIENT');
      return { ok: true, status: tenant.provisioningStatus, errors: [], resources: await this.integrations.tenantSummary(tenantId) };
    }
    const billingReady = !before.blockers.some((item: any) => item.category === 'billing');
    if (!billingReady) {
      await this.saveState(tenant, 'PROFILE_READY');
      return { ok: true, status: tenant.provisioningStatus, errors: [], resources: await this.integrations.tenantSummary(tenantId) };
    }
    if (tenant.provisioningStatus === 'TESTING') {
      const resources = await this.integrations.tenantSummary(tenantId);
      const status: TenantProvisioningStatus = tenant.lifecycleStatus === 'ACTIVE'
        ? 'ACTIVE'
        : before.ready || tenant.lifecycleStatus === 'READY_FOR_ACTIVATION'
          ? 'READY'
          : 'TESTING';
      await this.saveState(tenant, status);
      return { ok: true, status: tenant.provisioningStatus, errors: [], resources };
    }
    await this.saveState(tenant, 'BILLING_READY');

    const results: PromiseSettledResult<unknown>[] = [];
    if (before.enabledServices.email) {
      await this.saveState(tenant, 'EMAIL_PROVISIONING');
      results.push(await Promise.resolve(this.email.provisionTenant(tenantId)).then(
        (value) => ({ status: 'fulfilled', value }) as const,
        (reason) => ({ status: 'rejected', reason }) as const,
      ));
    } else {
      results.push({ status: 'fulfilled', value: null });
    }
    if (before.enabledServices.sms) {
      await this.saveState(tenant, 'SMS_PROVISIONING');
      results.push(await Promise.resolve(this.twilio.provisionTenant(tenantId)).then(
        (value) => ({ status: 'fulfilled', value }) as const,
        (reason) => ({ status: 'rejected', reason }) as const,
      ));
    } else {
      results.push({ status: 'fulfilled', value: null });
    }
    const errors = results.flatMap((result) =>
      result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
        : [],
    );
    const migratedProviders = [
      results[1].status === 'fulfilled' && before.enabledServices.sms ? 'twilio' : null,
      results[0].status === 'fulfilled' && before.enabledServices.email ? 'sendgrid' : null,
    ].filter((provider): provider is string => Boolean(provider));
    if (migratedProviders.length) {
      const legacy = await this.legacyCredentials.find({
        where: { tenant: { id: tenantId } as any },
        relations: ['tenant'],
      });
      const obsolete = legacy.filter((row) => migratedProviders.includes(row.provider));
      if (obsolete.length) await this.legacyCredentials.remove(obsolete);
    }
    const resources = await this.integrations.tenantSummary(tenantId);
    if (errors.length) {
      const summary = sanitizeOperationalText(errors.join('; '), 1_000);
      await this.saveState(tenant, 'ACTION_REQUIRED', summary);
      await this.operations.createTask({
        tenantId,
        category: 'provider_configuration',
        title: 'Managed provider provisioning needs attention',
        description: summary,
        priority: 'high',
        relatedEntityType: 'tenant',
        relatedEntityId: tenantId,
        dedupeOpen: true,
      });
      return { ok: false, status: tenant.provisioningStatus, errors, resources };
    }

    const after = await this.onboarding.readiness(tenantId);
    const compliancePending = before.enabledServices.sms &&
      resources.twilio.display?.complianceStatus !== 'approved';
    const status: TenantProvisioningStatus = tenant.lifecycleStatus === 'ACTIVE'
      ? 'ACTIVE'
      : after.ready || tenant.lifecycleStatus === 'READY_FOR_ACTIVATION'
        ? 'READY'
        : compliancePending
          ? 'COMPLIANCE_PENDING'
          : 'TESTING';
    await this.saveState(tenant, status);
    await this.operations.resolveRecoverableTasks({
      tenantId,
      category: 'provider_configuration',
      relatedEntityType: 'tenant',
      relatedEntityId: tenantId,
      evidenceNote: 'Provider reconciliation completed successfully.',
    });
    return {
      ok: true,
      status: tenant.provisioningStatus,
      errors,
      resources,
    };
  }
}
