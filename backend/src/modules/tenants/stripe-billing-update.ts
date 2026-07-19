import { TenantStatus } from './tenant.entity';

export function mapStripeStatusToTenantStatus(stripeStatus: string | null | undefined): TenantStatus {
  const s = String(stripeStatus || '').toLowerCase();

  if (s === 'trialing') return 'trialing';
  if (s === 'active') return 'active';
  if (s === 'past_due') return 'past_due';
  if (s === 'canceled') return 'canceled';
  if (s === 'unpaid') return 'unpaid';
  if (s === 'incomplete') return 'incomplete';
  if (s === 'incomplete_expired') return 'incomplete_expired';
  if (s === 'paused') return 'paused';

  // Unknown or missing provider states must never grant service.
  return 'incomplete';
}

export function toDateOrNull(unixSeconds: any): Date | null {
  const n = Number(unixSeconds);
  if (!n || Number.isNaN(n)) return null;
  return new Date(n * 1000);
}
