import { ForbiddenException } from '@nestjs/common';
import { Tenant } from '../tenants/tenant.entity';

export type LeadAcceptanceContext = {
  source: string;
  controlledTest?: boolean;
  testRunId?: string | null;
};

export function assertLeadAcceptance(
  tenant: Pick<Tenant, 'id' | 'lifecycleStatus'>,
  context: LeadAcceptanceContext,
) {
  const lifecycle = String(tenant.lifecycleStatus || 'ONBOARDING');
  if (lifecycle === 'ACTIVE' && context.controlledTest !== true) return;
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
