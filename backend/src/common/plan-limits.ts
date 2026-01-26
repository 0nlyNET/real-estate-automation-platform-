import { Plan } from '../modules/tenants/tenant.entity';

export type LimitKey = 'leads' | 'monthlyMessages';

export interface PlanLimits {
  leads: number;
  monthlyMessages: number;
}

export function getPlanLimits(plan: Plan): PlanLimits {
  switch (plan) {
    case 'teams':
      return { leads: 5000, monthlyMessages: 50000 };
    case 'pro':
      return { leads: 1000, monthlyMessages: 10000 };
    case 'free':
      return { leads: 100, monthlyMessages: 300 };
    case 'trial':
    default:
      return { leads: 200, monthlyMessages: 800 };
  }
}
