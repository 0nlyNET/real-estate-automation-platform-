import { BillingReconciliationService } from './billing-reconciliation.service';

describe('Stripe reconciliation uses the canonical payment verifier', () => {
  const original = process.env.STRIPE_SECRET_KEY;
  beforeEach(() => { process.env.STRIPE_SECRET_KEY = 'sk_test_reconcile'; });
  afterEach(() => { if (original === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = original; });

  function setup() {
    const tenant: any = { id: 'tenant-1', status: 'active', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', stripeSubscriptionStatus: 'active' };
    const tenants = {
      findById: jest.fn(async () => tenant),
      updateBilling: jest.fn(async (_id, patch) => Object.assign(tenant, patch)),
    };
    const billing = {
      reconcileSubscription: jest.fn().mockResolvedValue(tenant),
      withCustomerLock: jest.fn(async (_customer, callback) => callback()),
    };
    const service = new BillingReconciliationService(tenants as any, billing as any);
    const list = jest.fn();
    (service as any).stripe = { subscriptions: { list } };
    return { tenant, tenants, billing, service, list };
  }

  it('repairs stale active status when Stripe has no open subscription', async () => {
    const h = setup();
    h.list.mockResolvedValue({ data: [{ id: 'sub_1', status: 'canceled', created: 1, canceled_at: 1785826250 }] });
    await expect(h.service.reconcileTenant(h.tenant.id)).resolves.toMatchObject({ status: 'canceled' });
    expect(h.tenants.updateBilling).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ status: 'canceled', stripeCheckoutSessionId: null }));
  });

  it('delegates active subscriptions to price, ownership and payment verification', async () => {
    const h = setup();
    const subscription = { id: 'sub_1', status: 'active', created: 2 };
    h.list.mockResolvedValue({ data: [subscription] });
    await h.service.reconcileTenant(h.tenant.id);
    expect(h.billing.reconcileSubscription).toHaveBeenCalledWith(subscription, 'tenant-1');
    expect(h.tenants.updateBilling).not.toHaveBeenCalled();
  });

  it('propagates payment verification failures without enabling access', async () => {
    const h = setup();
    h.list.mockResolvedValue({ data: [{ id: 'sub_1', status: 'active', created: 2 }] });
    h.billing.reconcileSubscription.mockRejectedValue(new Error('Payment verification failed'));
    await expect(h.service.reconcileTenant(h.tenant.id)).rejects.toThrow('Payment verification failed');
    expect(h.tenants.updateBilling).not.toHaveBeenCalled();
  });

  it('does not call Stripe before a customer is created', async () => {
    const h = setup(); h.tenant.stripeCustomerId = null;
    await expect(h.service.reconcileTenant(h.tenant.id)).resolves.toMatchObject({ reconciled: false });
    expect(h.list).not.toHaveBeenCalled();
  });
});
