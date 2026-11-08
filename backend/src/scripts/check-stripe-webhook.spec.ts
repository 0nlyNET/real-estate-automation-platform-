import { checkStripeWebhook, REQUIRED_BILLING_EVENTS } from './check-stripe-webhook';

describe('Stripe endpoint repair', () => {
  function setup(overrides: any = {}) {
    const endpoint = { id: 'we_test', url: 'https://stage.example/billing/webhook', livemode: false,
      status: 'enabled', enabled_events: ['invoice.payment_failed', 'customer.created'], ...overrides };
    const retrieve = jest.fn(async () => endpoint);
    const update = jest.fn(async (_id, patch) => { endpoint.enabled_events = patch.enabled_events; return endpoint; });
    return { stripe: { webhookEndpoints: { retrieve, update } } as any, endpoint, update };
  }
  const input = { endpointId: 'we_test', backendOrigin: 'https://stage.example', appEnv: 'staging' };
  it('dry-runs and identifies the missing events without mutating', async () => {
    const x = setup(); const result = await checkStripeWebhook(x.stripe, input);
    expect(result.missing).toContain('refund.created'); expect(result.missing).toContain('charge.dispute.created');
    expect(x.update).not.toHaveBeenCalled();
  });
  it('adds missing events, preserves existing subscriptions, and verifies readback', async () => {
    const x = setup(); await checkStripeWebhook(x.stripe, { ...input, apply: true });
    expect(x.endpoint.enabled_events).toEqual(expect.arrayContaining([...REQUIRED_BILLING_EVENTS, 'customer.created']));
    await checkStripeWebhook(x.stripe, { ...input, apply: true });
    expect(x.update).toHaveBeenCalledTimes(1);
  });
  it.each([{ livemode: true }, { url: 'https://prod.example/billing/webhook' }, { status: 'disabled' }])('fails closed on the wrong target', async overrides => {
    const x = setup(overrides); await expect(checkStripeWebhook(x.stripe, { ...input, apply: true })).rejects.toThrow();
    expect(x.update).not.toHaveBeenCalled();
  });
  it('accepts a wildcard without narrowing it', async () => {
    const x = setup({ enabled_events: ['*'] });
    expect((await checkStripeWebhook(x.stripe, { ...input, apply: true })).missing).toEqual([]);
    expect(x.update).not.toHaveBeenCalled();
  });
});
