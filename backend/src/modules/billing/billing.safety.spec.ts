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

  function setup(options: { tenant?: any; eventRepo?: any; serviceControl?: any } = {}) {
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
      undefined,
      undefined,
      options.serviceControl as any,
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

  it('creates one live invoice summary and one notification when Stripe retries a paid invoice', async () => {
    let ledger: any = null;
    const events = {
      create: jest.fn((value) => ({ ...value })),
      save: jest.fn(async (value) => {
        if (!value.id && ledger) {
          throw Object.assign(new Error('duplicate'), { code: '23505' });
        }
        ledger = value.id
          ? { ...ledger, ...value }
          : { id: 'ledger-1', ...value };
        return ledger;
      }),
      findOne: jest.fn(async () => ledger),
    };
    const billingEvents = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'billing-1', ...value })),
    };
    const notifications = { createForPlatform: jest.fn().mockResolvedValue([]) };
    const tenants = {
      findById: jest.fn(),
      findByStripeReference: jest.fn().mockResolvedValue({ id: 'tenant-1' }),
      updateBilling: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BillingService(
      tenants as any,
      events as any,
      {} as any,
      { update: jest.fn() } as any,
      undefined,
      { createTask: jest.fn() } as any,
      billingEvents as any,
      notifications as any,
    );
    const subscription = {
      id: 'sub_1', status: 'active', customer: 'cus_1', metadata: { tenantId: 'tenant-1' },
      cancel_at_period_end: false, cancel_at: null, canceled_at: null, ended_at: null,
      trial_start: null, trial_end: null, latest_invoice: 'in_1', currency: 'usd',
      items: { data: [{ current_period_start: 1_784_419_200, current_period_end: 1_787_011_200,
        price: { id: 'price_teams_month', product: 'prod_1', unit_amount: 150000, currency: 'usd', recurring: { interval: 'month' } } }] },
    };
    const event = {
      id: 'evt_invoice_paid', type: 'invoice.payment_succeeded', created: 1_784_419_200,
      livemode: true, api_version: '2025-01-01',
      data: { object: { id: 'in_1', customer: 'cus_1', subscription: 'sub_1', amount_paid: 150000, amount_due: 150000, currency: 'usd' } },
    };
    (service as any).stripe = {
      webhooks: { constructEvent: jest.fn().mockReturnValue(event) },
      subscriptions: { retrieve: jest.fn().mockResolvedValue(subscription) },
    };

    await expect(service.handleWebhook(Buffer.from('{}'), 'valid')).resolves.toEqual({ received: true });
    await expect(service.handleWebhook(Buffer.from('{}'), 'valid')).resolves.toEqual({ received: true, duplicate: true });
    expect(billingEvents.save).toHaveBeenCalledTimes(1);
    expect(billingEvents.create).toHaveBeenCalledWith(expect.objectContaining({
      providerEventId: 'evt_invoice_paid', tenantId: 'tenant-1', eventType: 'invoice_paid',
      amountCents: 150000, currency: 'usd', livemode: true,
    }));
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(1);
    expect(notifications.createForPlatform).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'billing.invoice_paid', deduplicationKey: 'stripe:evt_invoice_paid' }),
    );
  });

  it('automatically suspends service after a confirmed failed payment when no grace period exists', async () => {
    process.env.BILLING_GRACE_DAYS = '0';
    const serviceControl = { suspend: jest.fn().mockResolvedValue({ changed: true }) };
    const { service } = setup({ serviceControl });
    const subscription = {
      id: 'sub_1',
      status: 'past_due',
      customer: 'cus_1',
      metadata: { tenantId: 'tenant-1' },
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: null,
      ended_at: null,
      trial_start: null,
      trial_end: null,
      latest_invoice: 'in_failed',
      currency: 'usd',
      items: {
        data: [
          {
            current_period_start: 1_784_419_200,
            current_period_end: 1_787_011_200,
            price: {
              id: 'price_pro_month',
              product: 'prod_1',
              unit_amount: 29900,
              currency: 'usd',
              recurring: { interval: 'month' },
            },
          },
        ],
      },
    };
    const event = {
      id: 'evt_invoice_failed',
      type: 'invoice.payment_failed',
      created: 1_784_419_200,
      livemode: true,
      data: {
        object: {
          id: 'in_failed',
          customer: 'cus_1',
          subscription: 'sub_1',
          amount_due: 29900,
          currency: 'usd',
        },
      },
    };
    (service as any).stripe = {
      webhooks: { constructEvent: jest.fn().mockReturnValue(event) },
      subscriptions: { retrieve: jest.fn().mockResolvedValue(subscription) },
    };

    await expect(service.handleWebhook(Buffer.from('{}'), 'valid')).resolves.toEqual({
      received: true,
    });
    expect(serviceControl.suspend).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      source: 'billing',
      reason:
        'Stripe confirmed a failed payment and no billing grace period is configured.',
    });
  });
});
