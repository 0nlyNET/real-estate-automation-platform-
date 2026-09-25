import { BillingService } from './billing.service';
import { TenantsService } from '../tenants/tenants.service';

/**
 * Regression tests for Stripe livemode enforcement (Phase 2).
 *
 * The Row incident: a test-mode Stripe event mutated production billing
 * state, leaving a stale $499 trial record. handleWebhook() must reject
 * test-mode events in production and live-mode events outside production,
 * returning 200 (no retry) without touching billing state.
 */
describe('BillingService webhook livemode enforcement', () => {
  const tenants = {} as TenantsService;
  const origNodeEnv = process.env.NODE_ENV;
  const origWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Minimal Stripe.Event shapes — only the fields handleWebhook reads
  // before the livemode gate (id, type, livemode).
  const testModeEvent = {
    id: 'evt_test_123',
    type: 'checkout.session.completed',
    livemode: false,
    data: { object: { customer: 'cus_test123' } },
  };
  const liveModeEvent = {
    id: 'evt_live_456',
    type: 'checkout.session.completed',
    livemode: true,
  };

  function serviceWithMockedVerify(mockEvent: object) {
    const service = new BillingService(tenants);
    // Bypass signature verification: return the canned event directly.
    const stripe = (service as any).getStripe();
    stripe.webhooks = {
      constructEvent: jest.fn().mockReturnValue(mockEvent),
    };
    jest.spyOn(service as any, 'getStripe').mockReturnValue(stripe);
    return service;
  }

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
    process.env.STRIPE_SECRET_KEY = 'sk_test_livemode_regression';
  });

  afterEach(() => {
    process.env.NODE_ENV = origNodeEnv;
    if (origWebhookSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = origWebhookSecret;
    }
    delete process.env.STRIPE_SECRET_KEY;
    jest.restoreAllMocks();
  });

  it('rejects test-mode events in production without mutating billing state', async () => {
    process.env.NODE_ENV = 'production';
    const service = serviceWithMockedVerify(testModeEvent);

    const result = await service.handleWebhook(
      Buffer.from('{}'),
      't=123,v1=abc',
    );

    expect(result).toEqual({
      received: true,
      rejected: 'test_mode_event_in_production',
    });
  });

  it('rejects live-mode events in non-production without mutating billing state', async () => {
    process.env.NODE_ENV = 'staging';
    const service = serviceWithMockedVerify(liveModeEvent);

    const result = await service.handleWebhook(
      Buffer.from('{}'),
      't=123,v1=abc',
    );

    expect(result).toEqual({
      received: true,
      rejected: 'live_mode_event_in_non_production',
    });
  });

  it('accepts test-mode events in non-production (passes the gate)', async () => {
    process.env.NODE_ENV = 'staging';
    const service = serviceWithMockedVerify(testModeEvent);
    // withCustomerLock is called after the gate — stub it to prove we got
    // past the gate without touching the DB.
    const lockSpy = jest
      .spyOn(service as any, 'withCustomerLock')
      .mockImplementation(async (_key: string, fn: () => Promise<unknown>) => fn());
    jest
      .spyOn(service as any, 'processVerifiedEvent')
      .mockResolvedValue({ received: true });

    await service.handleWebhook(Buffer.from('{}'), 't=123,v1=abc');

    expect(lockSpy).toHaveBeenCalled();
  });
});
