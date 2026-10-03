import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperatorTestGuard } from '../messaging/operator-test.guard';
import { Tenant } from '../tenants/tenant.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';

export type ProtectedServiceAction =
  | 'start_automation'
  | 'enroll_lead'
  | 'run_sequence_step'
  | 'send_automated_sms'
  | 'send_automated_email'
  | 'send_manual_sms'
  | 'send_manual_email'
  | 'create_automated_appointment'
  | 'deliver_integration_webhook'
  | 'trigger_service_from_intake'
  | 'trigger_service_from_manual_lead'
  | 'enable_automation'
  | 'add_team_member';

export type EntitlementOptions = {
  controlledTest?: boolean;
  operatorTest?: { grantId?: string; recipientEmail: string; channel: 'email' | 'sms' };
};

export type EntitlementDecision = {
  allowed: boolean;
  reasons: string[];
  billingEligible: boolean;
  lifecycleEligible: boolean;
  automationEnabled: boolean;
  globalAutomationPaused: boolean;
  graceEndsAt: string | null;
  operatorTestGrantId?: string | null;
};

export function configuredBillingGraceDays() {
  const parsed = Number(process.env.BILLING_GRACE_DAYS ?? '0');
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(Math.floor(parsed), 0), 14);
}

export function billingEligibility(
  tenant: Pick<
    Tenant,
    'status' | 'trialEndsAt' | 'lastPaymentFailureAt' | 'paymentConfirmedAt' | 'paidSubscriptionId' | 'stripeSubscriptionId'
  >,
  now = new Date(),
) {
  const status = String(tenant.status || '').toLowerCase();
  if (!tenant.paymentConfirmedAt || !tenant.stripeSubscriptionId ||
      tenant.paidSubscriptionId !== tenant.stripeSubscriptionId) {
    return { allowed: false, reason: 'Payment has not been confirmed by Stripe', graceEndsAt: null };
  }
  if (status === 'active') return { allowed: true, reason: null, graceEndsAt: null };
  if (status === 'past_due') {
    const days = configuredBillingGraceDays();
    const failedAt = tenant.lastPaymentFailureAt?.getTime();
    const graceEndsAt = failedAt
      ? new Date(failedAt + days * 24 * 60 * 60 * 1000)
      : null;
    if (days > 0 && graceEndsAt && graceEndsAt > now) {
      return { allowed: true, reason: null, graceEndsAt };
    }
    return {
      allowed: false,
      reason: 'Payment is past due and the configured grace period has ended',
      graceEndsAt,
    };
  }
  return {
    allowed: false,
    reason: `Billing status ${status || 'unknown'} is not eligible for service`,
    graceEndsAt: null,
  };
}

@Injectable()
export class EntitlementService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @InjectRepository(TenantSettings)
    private readonly settings: Repository<TenantSettings>,
    @Optional() private readonly operatorTests?: OperatorTestGuard,
  ) {}

  async workspaceAccess(tenantId: string) {
    const tenant = tenantId ? await this.tenants.findOne({ where: { id: tenantId } }) : null;
    const billing = tenant ? billingEligibility(tenant) : { allowed: false, reason: 'Workspace not found' };
    const suspended = !tenant || ['SUSPENDED', 'CANCELED'].includes(tenant.lifecycleStatus);
    // P8: a billing-source suspension keeps server-enforced READ-ONLY access
    // (the interceptor allows GET while blocking mutations). Manual, safety,
    // compliance and offboarding suspensions stay fully strict.
    const billingSuspended =
      !!tenant &&
      tenant.lifecycleStatus === 'SUSPENDED' &&
      tenant.serviceSuspensionSource === 'billing';
    return {
      allowed: billing.allowed && !suspended,
      billingEligible: billing.allowed,
      reason: billing.reason || (suspended ? 'Workspace services are suspended' : null),
      suspensionSource: tenant?.serviceSuspensionSource || null,
      lifecycleStatus: tenant?.lifecycleStatus || null,
      billingSuspended,
    };
  }

  async evaluate(
    tenantId: string,
    action: ProtectedServiceAction,
    now = new Date(),
    options?: EntitlementOptions,
  ): Promise<EntitlementDecision> {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) {
      return {
        allowed: false,
        reasons: ['Workspace not found'],
        billingEligible: false,
        lifecycleEligible: false,
        automationEnabled: false,
        globalAutomationPaused:
          process.env.GLOBAL_AUTOMATIONS_DISABLED === 'true',
        graceEndsAt: null,
      };
    }
    const workspaceSettings = await this.settings.findOne({ where: { tenantId } });
    const billing = billingEligibility(tenant, now);
    const manualReplyAction = ['send_manual_sms', 'send_manual_email'].includes(action);
    const controlledTesting =
      tenant.lifecycleStatus === 'TESTING' && options?.controlledTest === true;
    const lifecycleEligible = manualReplyAction
      ? ['ACTIVE', 'PAUSED', 'ONBOARDING'].includes(
          String(tenant.lifecycleStatus || 'ONBOARDING'),
        ) || controlledTesting
      : tenant.lifecycleStatus === 'ACTIVE' || controlledTesting;
    const automationEnabled = workspaceSettings?.automationsEnabled === true;
    const globalAutomationPaused =
      process.env.GLOBAL_AUTOMATIONS_DISABLED === 'true';
    // Authorized human replies are allowed for controlled testing during
    // onboarding or a pause. Suspended/canceled workspaces remain fail-closed.
    const automationAction = ![
      'add_team_member',
      'enable_automation',
      'send_manual_sms',
      'send_manual_email',
    ].includes(action);
    // Only email sends may use a server-side grant. It never changes billing
    // eligibility, lifecycle, automation controls, or any other service action.
    const emailAction = ['send_manual_email', 'send_automated_email'].includes(action);
    let operatorTestGrantId: string | null = null;
    if (emailAction && options?.operatorTest?.channel === 'email' && this.operatorTests) {
      const grant = await this.operatorTests.validateGrant({
        tenantId,
        recipientEmail: options.operatorTest.recipientEmail,
        channel: 'email',
        grantId: options.operatorTest.grantId,
      });
      operatorTestGrantId = grant?.id || null;
    }
    const reasons: string[] = [];
    if (options?.operatorTest?.grantId && !operatorTestGrantId) {
      reasons.push('Operator test grant is invalid, expired, or revoked');
    }
    if (!billing.allowed && !operatorTestGrantId && billing.reason) reasons.push(billing.reason);
    if (!lifecycleEligible)
      reasons.push(`Workspace lifecycle is ${tenant.lifecycleStatus || 'ONBOARDING'}`);
    if (automationAction && globalAutomationPaused)
      reasons.push('Platform automation is globally paused');
    if (automationAction && !automationEnabled && !controlledTesting)
      reasons.push('Workspace automation is disabled');

    return {
      allowed: reasons.length === 0,
      reasons,
      billingEligible: billing.allowed,
      lifecycleEligible,
      automationEnabled,
      globalAutomationPaused,
      graceEndsAt: billing.graceEndsAt?.toISOString() || null,
      operatorTestGrantId,
    };
  }

  async assertAllowed(
    tenantId: string,
    action: ProtectedServiceAction,
    options?: EntitlementOptions,
  ) {
    const decision = await this.evaluate(tenantId, action, new Date(), options);
    if (!decision.allowed) {
      throw new ForbiddenException({
        code: 'SERVICE_NOT_ENTITLED',
        message: 'This service action is currently blocked',
        reasons: decision.reasons,
      });
    }
    return decision;
  }
}
