import { Plan } from '../modules/tenants/tenant.entity';

export type PlanName = Plan;

export function managedServiceSeatLimit(): number {
  // Preserve the former paid-service allowance while removing plan tiers.
  return 10;
}

export function planNameForDisplay(plan: PlanName): string {
  if (['service', 'pro', 'teams', 'enterprise'].includes(plan)) {
    return 'managed service';
  }
  return plan || 'trial';
}
