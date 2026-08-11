import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  | 'trigger_service_from_intake'
  | 'trigger_service_from_manual_lead'
  | 'enable_automation'
  | 'add_team_member';

export type EntitlementDecision = {
  allowed: boolean;
  reasons: string[];
  billingEligible: boolean;
  lifecycleEligible: boolean;
  automationEnabled: boolean;
  globalAutomationPaused: boolean;
  graceEndsAt: string | null;
};

export function configuredBillingGraceDays() {
  const parsed = Number(process.env.BILLING_GRACE_DAYS ?? '0');
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(Math.floor(parsed), 0), 14);
}

export function billingEligibility(
  tenant: Pick<
    Tenant,
    'status' | 'trialEndsAt' | 'lastPaymentFailureAt'
  >,
  now = new Date(),
) {
  const status = String(tenant.status || '').toLowerCase();
  if (status === 'active') return { allowed: true, reason: null, graceEndsAt: null };
  if (status === 'trialing') {
    const trialEnd = tenant.trialEndsAt?.getTime();
    return trialEnd && trialEnd > now.getTime()
      ? { allowed: true, reason: null, graceEndsAt: null }
      : { allowed: false, reason: 'Trial has expired', graceEndsAt: null };
  }
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
  ) {}

  async evaluate(
    tenantId: string,
    action: ProtectedServiceAction,
    now = new Date(),
    options?: { controlledTest?: boolean },
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
    const reasons: string[] = [];
    if (!billing.allowed && billing.reason) reasons.push(billing.reason);
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
    };
  }

  async assertAllowed(
    tenantId: string,
    action: ProtectedServiceAction,
    options?: { controlledTest?: boolean },
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
