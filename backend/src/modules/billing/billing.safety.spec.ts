import { ConflictException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { configuredPriceId, planForStripePrice } from './stripe-plan-config';

describe('Stripe billing safety controls', () => {
  const original = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, {
      STRIPE_SECRET_KEY: 'sk_test_configured',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_PRICE_PRO_MONTH: 'price_pro_month',
      STRIPE_PRICE_PRO_YEAR: 'price_pro_year',
      STRIPE_PRICE_TEAMS_MONTH: 'price_teams_month',
      STRIPE_PRICE_TEAMS_YEAR: 'price_teams_year',
    });
  });

  afterEach(() => {
    process.env = { ...original };
  });

  function setup(options: { tenant?: any; eventRepo?: any } = {}) {
    const tenant = options.tenant || {
      id: 'tenant-1',
      status: 'incomplete',
      stripeCustomerId: 'cus_1',
    };
    const tenants = {
      findById: jest.fn().mockResolvedValue(tenant),
      updateBilling: jest.fn().mockResolvedValue(undefined),
      setStripeCustomer: jest.fn(),
      findByStripeReference: jest.fn().mockResolvedValue(tenant),
    };
    const settings = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
    const service = new BillingService(
      tenants as any,
      options.eventRepo as any,
      {} as any,
      settings as any,
      undefined,
      operations as any,
    );
    return { service, tenant, tenants, settings, operations };
  }

  it('uses one central server-side price map and rejects unconfigured selections', () => {
    expect(configuredPriceId('pro', 'month')).toBe('price_pro_month');
    expect(planForStripePrice('price_teams_year')).toEqual({
      plan: 'teams',
      interval: 'year',
      priceId: 'price_teams_year',
    });
    expect(planForStripePrice('price_unknown')).toBeNull();
  });

  it('blocks duplicate checkout before creating a Stripe session', async () => {
    const { service } = setup({
      tenant: {
        id: 'tenant-1',
        stripeCheckoutSessionId: 'cs_open',
        stripeCheckoutStartedAt: new Date(),
      },
    });
    const fakeStripe = {
      checkout: { sessions: { create: jest.fn() } },
      subscriptions: { list: jest.fn() },
    };
    (service as any).stripe = fakeStripe;
    await expect(
      service.createCheckoutSession({
        tenantId: 'tenant-1',
        userEmail: 'owner@example.com',
        plan: 'pro',
        interval: 'month',
        successUrl: 'https://app.example.com/success',
        cancelUrl: 'https://app.example.com/cancel',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fakeStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('verifies the signature before touching the replay ledger', async () => {
    const events = { create: jest.fn(), save: jest.fn() };
    const { service } = setup({ eventRepo: events });
    const signatureError = new Error('bad signature');
    (service as any).stripe = {
      webhooks: { constructEvent: jest.fn(() => { throw signatureError; }) },
    };
    await expect(service.handleWebhook(Buffer.from('{}'), 'invalid')).rejects.toBe(signatureError);
    expect(events.create).not.toHaveBeenCalled();
    expect(events.save).not.toHaveBeenCalled();
  });

  it('returns an idempotent success for a completed replay', async () => {
    const existing = {
      stripeEventId: 'evt_1',
      processingStatus: 'completed',
      processingStartedAt: new Date(),
    };
    const events = {
      create: jest.fn((value) => value),
      save: jest.fn().mockRejectedValue(Object.assign(new Error('duplicate'), { code: '23505' })),
      findOne: jest.fn().mockResolvedValue(existing),
    };
    const { service } = setup({ eventRepo: events });
    (service as any).stripe = {
      webhooks: {
        constructEvent: jest.fn().mockReturnValue({
          id: 'evt_1',
          type: 'test.event',
          created: 1,
          data: { object: {} },
        }),
      },
    };
    await expect(service.handleWebhook(Buffer.from('{}'), 'valid')).resolves.toEqual({
      received: true,
      duplicate: true,
    });
  });

  it('synchronizes mapped subscription state and blocks unknown prices', async () => {
    const { service, tenants, operations } = setup();
    const subscription = (priceId: string) => ({
      id: 'sub_1',
      status: 'active',
      customer: 'cus_1',
      metadata: { tenantId: 'tenant-1' },
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: null,
      ended_at: null,
      trial_start: null,
      trial_end: null,
      latest_invoice: 'in_1',
      items: {
        data: [
          {
            current_period_start: 1_784_419_200,
            current_period_end: 1_787_011_200,
            price: { id: priceId, product: 'prod_1' },
          },
        ],
      },
    });
    const eventFor = (id: string, priceId: string) => ({
      id,
      type: 'customer.subscription.updated',
      created: 1_784_419_200,
      data: { object: subscription(priceId) },
    });
    const constructEvent = jest
      .fn()
      .mockReturnValueOnce(eventFor('evt_known', 'price_pro_month'))
      .mockReturnValueOnce(eventFor('evt_unknown', 'price_unknown'));
    (service as any).stripe = { webhooks: { constructEvent } };

    await expect(service.handleWebhook(Buffer.from('{}'), 'valid')).resolves.toEqual({ received: true });
    expect(tenants.updateBilling).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        plan: 'pro',
        billingInterval: 'month',
        status: 'active',
        stripePriceId: 'price_pro_month',
      }),
    );

    await expect(service.handleWebhook(Buffer.from('{}'), 'valid')).rejects.toThrow(
      'Unknown Stripe price ID',
    );
    expect(tenants.updateBilling).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ status: 'incomplete', stripePriceId: 'price_unknown' }),
    );
    expect(operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'unknown_stripe_price', priority: 'critical' }),
    );
  });
});
