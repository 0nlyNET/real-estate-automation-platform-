import { Plan } from '../modules/tenants/tenant.entity';

export type PlanName = Plan;

// Keep defaults explicit and easy to reason about.
// You can override these with env vars later if needed.
export function planSeatLimit(plan: PlanName): number {
  switch (plan) {
    case 'free':
    case 'trial':
    case 'pro':
      return 1;
    case 'teams':
      return 10;
    case 'enterprise':
      return 9999; // effectively unlimited
    default:
      return 1;
  }
}

export function planHasTeamsFeatures(plan: PlanName): boolean {
  return plan === 'teams' || plan === 'enterprise';
}

export function planNameForDisplay(plan: PlanName): string {
  return plan || 'trial';
}
