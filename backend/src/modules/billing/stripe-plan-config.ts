import { BadRequestException } from '@nestjs/common';

export type BillablePlan = 'pro' | 'teams';
export type BillingInterval = 'month' | 'year';

export function configuredServicePriceId() {
  return (
    String(process.env.STRIPE_PRICE_SERVICE_MONTH || '').trim() ||
    String(process.env.STRIPE_PRICE_TEAMS_MONTH || '').trim() ||
    null
  );
}

const priceEnvironment: Record<`${BillablePlan}:${BillingInterval}`, string> = {
  'pro:month': 'STRIPE_PRICE_PRO_MONTH',
  'pro:year': 'STRIPE_PRICE_PRO_YEAR',
  'teams:month': 'STRIPE_PRICE_TEAMS_MONTH',
  'teams:year': 'STRIPE_PRICE_TEAMS_YEAR',
};

export function configuredStripePrices() {
  return (Object.entries(priceEnvironment) as Array<
    [`${BillablePlan}:${BillingInterval}`, string]
  >).map(([key, environmentVariable]) => {
    const [plan, interval] = key.split(':') as [BillablePlan, BillingInterval];
    return {
      plan,
      interval,
      environmentVariable,
      priceId: String(process.env[environmentVariable] || '').trim() || null,
    };
  });
}

export function configuredPriceId(
  plan: BillablePlan,
  interval: BillingInterval,
) {
  if (plan === 'teams' && interval === 'month') {
    const servicePrice = configuredServicePriceId();
    if (servicePrice) return servicePrice;
  }
  const match = configuredStripePrices().find(
    (entry) => entry.plan === plan && entry.interval === interval,
  );
  if (!match?.priceId) {
    throw new BadRequestException(
      `Billing is not configured for ${plan} ${interval}; ${match?.environmentVariable || 'Stripe price'} is missing`,
    );
  }
  return match.priceId;
}

export function planForStripePrice(priceId?: string | null) {
  const normalized = String(priceId || '').trim();
  if (!normalized) return null;
  if (normalized === configuredServicePriceId()) {
    return { plan: 'teams' as const, interval: 'month' as const, priceId: normalized };
  }
  const match = configuredStripePrices().find(
    (entry) => entry.priceId === normalized,
  );
  return match
    ? { plan: match.plan, interval: match.interval, priceId: normalized }
    : null;
}

export function missingStripeConfiguration() {
  const billingEnabled = Boolean(String(process.env.STRIPE_SECRET_KEY || '').trim());
  if (!billingEnabled) return [];
  const missing = ['STRIPE_WEBHOOK_SECRET'].filter(
    (key) => !String(process.env[key] || '').trim(),
  );
  if (!configuredServicePriceId()) missing.push('STRIPE_PRICE_SERVICE_MONTH');
  return missing;
}
