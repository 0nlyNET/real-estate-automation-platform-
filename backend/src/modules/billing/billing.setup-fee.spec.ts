import { BillingService } from './billing.service';
import {
  requireConfiguredServicePriceId,
  requireConfiguredSetupPriceId,
} from './stripe-plan-config';

describe('Stripe one-time setup fee billing', () => {
  const original = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, {
      STRIPE_SECRET_KEY: 'sk_test_configured',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      STRIPE_PRICE_SERVICE_MONTH: 'price_service_month',
      STRIPE_PRICE_SETUP_ONCE: 'price_setup_once',
    });
  });

  afterEach(() => {
    process.env = { ...original };
  });

  function setup(tenantPatch: Record<string, unknown> = {}) {
    let tenant: any = {
      id: 'tenant-1',
      status: 'incomplete',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: null,
      stripeCheckoutSessionId: null,
      stripeCheckoutStartedAt: null,
      setupPaidAt: null,
      setupInvoiceId: null,
      setupStripePriceId: null,
      ...tenantPatch,
    };
    const tenants = {
      findById: jest.fn(async () => tenant),
      updateBilling: jest.fn(async (_tenantId: string, patch: Record<string, unknown>) => {
        tenant = { ...tenant, ...patch };
        return tenant;
      }),
      setStripeCustomer: jest.fn(async (_tenantId: string, customerId: string) => {
        tenant = { ...tenant, stripeCustomerId: customerId };
      }),
      findByStripeReference: jest.fn(async () => tenant),
    };
    const service = new BillingService(tenants as any);
    return { service, tenants, getTenant: () => tenant };
  }

  function checkoutStripe() {
    const create = jest.fn().mockResolvedValue({
      id: 'cs_1',
      url: 'https://checkout.stripe.test/cs_1',
    });
    return {
      checkout: { sessions: { create } },
      subscriptions: {
        list: jest.fn().mockResolvedValue({ data: [] }),
      },
      create,
    };
  }

  const checkoutParams = {
    tenantId: 'tenant-1',
    userEmail: 'owner@example.com',
    successUrl: 'https://app.example.com/success',
    cancelUrl: 'https://app.example.com/cancel',
  };

  it('requires distinct recurring and setup prices', () => {
    expect(requireConfiguredServicePriceId()).toBe('price_service_month');
    expect(requireConfiguredSetupPriceId()).toBe('price_setup_once');

    process.env.STRIPE_PRICE_SETUP_ONCE = 'price_service_month';
    expect(() => requireConfiguredSetupPriceId()).toThrow(
      'STRIPE_PRICE_SETUP_ONCE must differ from STRIPE_PRICE_SERVICE_MONTH',
    );
  });

  it('charges the monthly service and one-time setup fee in the first checkout', async () => {
    const { service } = setup();
    const fakeStripe = checkoutStripe();
    (service as any).stripe = fakeStripe;

    await expect(service.createCheckoutSession(checkoutParams)).resolves.toEqual({
      url: 'https://checkout.stripe.test/cs_1',
    });

    expect(fakeStripe.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [
          { price: 'price_service_month', quantity: 1 },
          { price: 'price_setup_once', quantity: 1 },
        ],
        metadata: {
          tenantId: 'tenant-1',
          setupFeeIncluded: 'true',
          setupPriceId: 'price_setup_once',
        },
        subscription_data: {
          metadata: {
            tenantId: 'tenant-1',
            setupFeeIncluded: 'true',
            setupPriceId: 'price_setup_once',
          },
        },
      }),
      expect.objectContaining({ idempotencyKey: expect.stringContaining('checkout:tenant-1:') }),
    );
  });

  it('charges only the monthly service when setup was already paid', async () => {
    delete process.env.STRIPE_PRICE_SETUP_ONCE;
    const { service } = setup({
      setupPaidAt: new Date('2026-08-01T12:00:00.000Z'),
      setupInvoiceId: 'in_setup_paid',
      setupStripePriceId: 'price_setup_once',
    });
    const fakeStripe = checkoutStripe();
    (service as any).stripe = fakeStripe;

    await service.createCheckoutSession(checkoutParams);

    expect(fakeStripe.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_service_month', quantity: 1 }],
        metadata: {
          tenantId: 'tenant-1',
          setupFeeIncluded: 'false',
        },
        subscription_data: {
          metadata: {
            tenantId: 'tenant-1',
            setupFeeIncluded: 'false',
          },
        },
      }),
      expect.any(Object),
    );
  });

  it('does not open a new-client checkout when the setup price is missing', async () => {
    delete process.env.STRIPE_PRICE_SETUP_ONCE;
    const { service } = setup();
    const fakeStripe = checkoutStripe();
    (service as any).stripe = fakeStripe;

    await expect(service.createCheckoutSession(checkoutParams)).rejects.toThrow(
      'STRIPE_PRICE_SETUP_ONCE is missing',
    );
    expect(fakeStripe.create).not.toHaveBeenCalled();
  });

  it('records setup as paid only after Stripe confirms a successful invoice', async () => {
    const { service, tenants, getTenant } = setup();
    const subscription = {
      id: 'sub_1',
      status: 'active',
      customer: 'cus_1',
      metadata: {
        tenantId: 'tenant-1',
        setupFeeIncluded: 'true',
        setupPriceId: 'price_setup_once',
      },
      cancel_at_period_end: false,
      cancel_at: null,
      canceled_at: null,
      ended_at: null,
      trial_start: null,
      trial_end: null,
      latest_invoice: 'in_first',
      currency: 'usd',
      items: {
        data: [
          {
            current_period_start: 1_785_801_600,
            current_period_end: 1_788_480_000,
            price: {
              id: 'price_service_month',
              product: 'prod_service',
              unit_amount: 49900,
              currency: 'usd',
              recurring: { interval: 'month' },
            },
          },
        ],
      },
    };
    const event = {
      id: 'evt_first_invoice_paid',
      type: 'invoice.payment_succeeded',
      created: 1_785_801_600,
      livemode: false,
      data: {
        object: {
          id: 'in_first',
          customer: 'cus_1',
          subscription: 'sub_1',
          amount_paid: 79900,
          amount_due: 79900,
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

    expect(tenants.updateBilling).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        setupPaidAt: expect.any(Date),
        setupInvoiceId: 'in_first',
        setupStripePriceId: 'price_setup_once',
      }),
    );
    expect(getTenant()).toEqual(
      expect.objectContaining({
        setupInvoiceId: 'in_first',
        setupStripePriceId: 'price_setup_once',
      }),
    );
  });

  it('does not record setup after a failed first invoice', async () => {
    process.env.BILLING_GRACE_DAYS = '1';
    const { service, tenants } = setup();
    const subscription = {
      id: 'sub_1',
      status: 'past_due',
      customer: 'cus_1',
      metadata: {
        tenantId: 'tenant-1',
        setupFeeIncluded: 'true',
        setupPriceId: 'price_setup_once',
      },
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
            current_period_start: 1_785_801_600,
            current_period_end: 1_788_480_000,
            price: {
              id: 'price_service_month',
              product: 'prod_service',
              unit_amount: 49900,
              currency: 'usd',
              recurring: { interval: 'month' },
            },
          },
        ],
      },
    };
    const event = {
      id: 'evt_first_invoice_failed',
      type: 'invoice.payment_failed',
      created: 1_785_801_600,
      livemode: false,
      data: {
        object: {
          id: 'in_failed',
          customer: 'cus_1',
          subscription: 'sub_1',
          amount_due: 79900,
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

    const setupWrites = tenants.updateBilling.mock.calls.filter(([, patch]) =>
      Object.prototype.hasOwnProperty.call(patch, 'setupPaidAt'),
    );
    expect(setupWrites).toHaveLength(0);
  });
});
