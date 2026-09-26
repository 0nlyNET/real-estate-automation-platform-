import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
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
import { DurableJobsService } from '../durable-jobs/durable-jobs.service';
import { TwilioComplianceService } from './twilio-compliance.service';

@Injectable()
export class TenantProvisioningService implements OnModuleInit {
  private readonly logger = new Logger(TenantProvisioningService.name);

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
    @Optional() private readonly durableJobs?: DurableJobsService,
    @Optional() private readonly compliance?: TwilioComplianceService,
  ) {}

  onModuleInit() {
    if (!this.durableJobs) return;
    this.durableJobs.register('tenant.provision', async (job) => {
      if (!job.tenantId) throw new Error('Provisioning job is missing tenantId');
      try {
        await this.reconcileTenantProvisioning(job.tenantId);
      } catch (error: any) {
        if (job.attemptCount >= job.maxAttempts) {
          await this.operations.createTask({
            tenantId: job.tenantId,
            category: 'provider_configuration',
            title: 'Managed provider retries were exhausted',
            description: sanitizeOperationalText(error?.message || error),
            priority: 'high',
            relatedEntityType: 'tenant',
            relatedEntityId: job.tenantId,
            dedupeOpen: true,
          });
        }
        throw error;
      }
    });
    this.durableJobs.register('tenant.provisioning_scan', async () => {
      await this.reconcilePendingTenants();
      return { nextRunAt: new Date(Date.now() + 15 * 60_000) };
    });
    if (process.env.NODE_ENV !== 'test') {
      void this.durableJobs.schedule({
        taskType: 'tenant.provisioning_scan',
        dedupeKey: 'recurring:tenant.provisioning_scan',
      });
    }
  }

  scheduleTenant(tenantId: string, nextRunAt = new Date()) {
    if (!this.durableJobs) return this.reconcileTenantProvisioning(tenantId);
    return this.durableJobs.schedule({
      taskType: 'tenant.provision',
      tenantId,
      dedupeKey: `tenant.provision:${tenantId}`,
      nextRunAt,
    });
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

  /**
   * Minimum gap between automated SendGrid connection-test attempts for a
   * tenant. SendGrid sender verification is an external wait, so the scan
   * retries on this cadence instead of every 15-minute pass. The operator
   * can always force an immediate check via the manual test endpoint.
   */
  private static readonly EMAIL_AUTO_TEST_RETRY_MS = 6 * 60 * 60_000;

  /**
   * Safe automation (P10): automatically verify the tenant's managed email
   * identity once provisioning reaches a testable state.
   *
   * Never throws: a failed or skipped auto test must not break provisioning,
   * weaken any readiness gate, or activate the tenant.
   */
  private async maybeAutoVerifyEmailIdentity(tenantId: string) {
    try {
      const record = await this.onboarding.getOrCreate(tenantId);
      if (!record.emailEnabled) return;
      const tenant = await this.tenants.findOne({ where: { id: tenantId } });
      // Never auto-send from a live tenant; ACTIVE clients keep the manual flow.
      if (!tenant || tenant.lifecycleStatus === 'ACTIVE') return;
      const summary = await this.integrations.tenantSummary(tenantId);
      const status = String(summary?.sendgrid?.status || '');
      if (!['testing', 'failed'].includes(status)) return;
      const providerTests = (record.providerTests || {}) as Record<
        string,
        unknown
      >;
      const lastAttempt = Date.parse(
        String(providerTests.sendgridAutoTestLastAttemptedAt || ''),
      );
      if (
        Number.isFinite(lastAttempt) &&
        Date.now() - lastAttempt <
          TenantProvisioningService.EMAIL_AUTO_TEST_RETRY_MS
      ) {
        return;
      }
      // Auto-reconcile the approved sender identity first so the readiness
      // `sendgrid` item can pass in the same pass. An explicitly-set
      // different identity is never overridden; it is surfaced instead.
      const align =
        await this.onboarding.autoAlignApprovedEmailIdentity(tenantId);
      if (!align.ok && align.reason === 'mismatch') {
        await this.operations.createTask({
          tenantId,
          category: 'provider_configuration',
          title: 'Approved email identity does not match the provisioned sender',
          description: `The client-approved sender "${align.brandIdentity}" differs from the provisioned SendGrid identity "${align.provisionedIdentity}". Resolve with the client before the connection test can pass.`,
          priority: 'high',
          relatedEntityType: 'tenant',
          relatedEntityId: tenantId,
          dedupeOpen: true,
        });
      }
      const toEmail = await this.onboarding.connectionTestRecipient(tenantId);
      if (!toEmail) {
        this.logger.warn(
          `Skipping automated SendGrid connection test for ${tenantId}: no controlled test recipient is configured`,
        );
        return;
      }
      let result: { ok: boolean; error?: string };
      try {
        result = await this.integrations.testTenantSendGrid(tenantId, {
          toEmail,
        });
      } catch (error: any) {
        result = {
          ok: false,
          error: error?.message || 'SendGrid connection test failed',
        };
      }
      await this.onboarding.noteAutoConnectionTestAttempt(
        tenantId,
        'sendgrid',
        result.ok ? 'ok' : 'failed',
        result.ok ? undefined : result.error,
      );
      if (result.ok) {
        this.logger.log(
          `Automated SendGrid connection test passed for ${tenantId}`,
        );
        return;
      }
      await this.operations.createTask({
        tenantId,
        category: 'provider_configuration',
        title: 'Automated SendGrid connection test failed',
        description: sanitizeOperationalText(
          result.error || 'SendGrid connection test failed',
        ),
        priority: 'high',
        relatedEntityType: 'tenant',
        relatedEntityId: tenantId,
        dedupeOpen: true,
      });
    } catch (error: any) {
      this.logger.warn(
        `Automated SendGrid connection test skipped for ${tenantId}: ${sanitizeOperationalText(
          error?.message || error,
        )}`,
      );
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
      // Safe automation (P10): keep retrying the automated email connection
      // test on the regular scan cadence until the identity verifies.
      if (before.enabledServices.email) {
        await this.maybeAutoVerifyEmailIdentity(tenantId);
      }
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
      if (results[results.length - 1].status === 'fulfilled') {
        await this.compliance?.schedule(tenantId);
      }
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
      if (errors.every(isTransientProvisioningError)) {
        await this.saveState(tenant, tenant.provisioningStatus, summary);
        throw new Error(summary);
      }
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

    // Safe automation (P10): after the identity is provisioned, align the
    // approved sender identity and run the tenant SendGrid connection test
    // automatically. Success marks the identity verified, which clears the
    // `sendgrid` and `sendgrid_provider_approval` readiness blockers.
    // Activation still requires the explicit operator POST /activate.
    if (before.enabledServices.email) {
      await this.maybeAutoVerifyEmailIdentity(tenantId);
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
    if (status === 'TESTING' && !before.enabledServices.sms && this.durableJobs) {
      const record = await this.onboarding.getOrCreate(tenantId);
      await this.durableJobs.schedule({
        taskType: 'testing.start',
        tenantId,
        dedupeKey: `testing.start:${tenantId}`,
        payload: {
          smsRecipient: null,
          emailRecipient:
            record.contacts?.controlledTestEmail ||
            record.contacts?.accountOwner ||
            null,
        },
      });
    }
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

function isTransientProvisioningError(message: string) {
  return /\b(408|409|425|429|5\d\d)\b|abort|timeout|timed out|network|fetch failed|ECONN|EAI_AGAIN|socket|connection reset|temporar/i.test(
    message,
  );
}
