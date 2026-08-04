import { BadRequestException } from '@nestjs/common';

export type ServiceBillingInterval = 'month' | 'year';

export function configuredServicePriceId() {
  return String(process.env.STRIPE_PRICE_SERVICE_MONTH || '').trim() || null;
}

export function configuredSetupPriceId() {
  return String(process.env.STRIPE_PRICE_SETUP_ONCE || '').trim() || null;
}

export function requireConfiguredServicePriceId() {
  const priceId = configuredServicePriceId();
  if (!priceId) {
    throw new BadRequestException(
      'Billing is not configured; STRIPE_PRICE_SERVICE_MONTH is missing',
    );
  }
  return priceId;
}

export function requireConfiguredSetupPriceId() {
  const priceId = configuredSetupPriceId();
  if (!priceId) {
    throw new BadRequestException(
      'Billing is not configured; STRIPE_PRICE_SETUP_ONCE is missing',
    );
  }
  if (priceId === configuredServicePriceId()) {
    throw new BadRequestException(
      'Billing is not configured; STRIPE_PRICE_SETUP_ONCE must differ from STRIPE_PRICE_SERVICE_MONTH',
    );
  }
  return priceId;
}

export function planForStripePrice(priceId?: string | null) {
  const normalized = String(priceId || '').trim();
  const servicePriceId = configuredServicePriceId();
  if (!normalized || !servicePriceId || normalized !== servicePriceId) {
    return null;
  }
  return {
    plan: 'service' as const,
    interval: 'month' as const,
    priceId: normalized,
    compatibility: false as const,
  };
}

export function missingStripeConfiguration() {
  const billingEnabled = Boolean(
    String(process.env.STRIPE_SECRET_KEY || '').trim(),
  );
  if (!billingEnabled) return [];
  const missing = ['STRIPE_WEBHOOK_SECRET'].filter(
    (key) => !String(process.env[key] || '').trim(),
  );
  if (!configuredServicePriceId()) {
    missing.push('STRIPE_PRICE_SERVICE_MONTH');
  }
  if (!configuredSetupPriceId()) {
    missing.push('STRIPE_PRICE_SETUP_ONCE');
  }
  return missing;
}
