import { ForbiddenException } from '@nestjs/common';
import { Tenant } from '../tenants/tenant.entity';

export type LeadAcceptanceContext = {
  source: string;
  controlledTest?: boolean;
  testRunId?: string | null;
  retainDuringPause?: boolean;
};

export function assertLeadAcceptance(
  tenant: Pick<Tenant, 'id' | 'lifecycleStatus'> & Partial<Pick<Tenant, 'serviceActivatedAt' | 'servicePreviousLifecycleStatus' | 'serviceSuspensionSource'>>,
  context: LeadAcceptanceContext,
) {
  const lifecycle = String(tenant.lifecycleStatus || 'ONBOARDING');
  if (lifecycle === 'ACTIVE' && context.controlledTest !== true) return;
  if (context.controlledTest !== true && context.retainDuringPause === true && acceptsRetainedIntake(tenant)) return;
  if (
    lifecycle === 'TESTING' &&
    context.controlledTest === true &&
    String(context.testRunId || '').trim()
  ) return;
  throw new ForbiddenException({
    code: 'LEAD_INTAKE_NOT_ACTIVE',
    message:
      context.controlledTest === true
        ? 'Controlled test intake requires an active TESTING run.'
        : 'This workspace is not active and cannot accept live leads.',
    lifecycleStatus: lifecycle,
    source: context.source,
  });
}

// Existing launched workspaces retain leads during reversible service stops.
// Never admit new live intake into onboarding/test fixtures or offboarding.
export function acceptsRetainedIntake(
  tenant: Pick<Tenant, 'lifecycleStatus'> & Partial<Pick<Tenant,
    'serviceActivatedAt' | 'servicePreviousLifecycleStatus' | 'serviceSuspensionSource'>>,
): boolean {
  const previouslyActive = Boolean(tenant.serviceActivatedAt) ||
    tenant.servicePreviousLifecycleStatus === 'ACTIVE';
  return previouslyActive &&
    (tenant.lifecycleStatus === 'PAUSED' || tenant.lifecycleStatus === 'SUSPENDED') &&
    String(tenant.serviceSuspensionSource || '') !== 'offboarding';
}
