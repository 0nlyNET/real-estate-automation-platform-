import { BillingService } from './billing.service';
import { billingEligibility } from '../entitlements/entitlement.service';

describe('first-client payment evidence', () => {
  const original = { ...process.env };
  beforeEach(() => Object.assign(process.env, {
    STRIPE_SECRET_KEY: 'sk_test_first_client',
    STRIPE_PRICE_SERVICE_MONTH: 'price_service',
  }));
  afterEach(() => { process.env = { ...original }; });

  function harness() {
    const tenant: any = { id: 'tenant-1', status: 'incomplete', stripeCustomerId: 'cus_1' };
    const tenants = {
      findById: jest.fn(async () => tenant),
      updateBilling: jest.fn(async (_id, patch) => Object.assign(tenant, patch)),
    };
    const control = { restoreAfterPayment: jest.fn().mockResolvedValue({}), suspend: jest.fn() };
    const onboarding = { recordBillingFromStripe: jest.fn() };
    const service = new BillingService(tenants as any, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, control as any, undefined, onboarding as any);
    const invoice: any = { id: 'in_1', status: 'open', amount_paid: 0, customer: 'cus_1',
      parent: { subscription_details: { subscription: 'sub_1' } } };
    const subscription: any = { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: { tenantId: 'tenant-1' },
      latest_invoice: 'in_1', items: { data: [{ price: { id: 'price_service', product: 'prod_1', unit_amount: 49900,
        currency: 'usd', recurring: { interval: 'month' } }, current_period_start: 1788652800, current_period_end: 1791244800 }] } };
    (service as any).stripe = { invoices: { retrieve: jest.fn(async () => invoice) } };
    return { service, tenant, tenants, control, onboarding, invoice, subscription };
  }

  it('does not unlock an active subscription with an unpaid invoice', async () => {
    const h = harness();
    await h.service.reconcileSubscription(h.subscription, h.tenant.id);
    expect(billingEligibility(h.tenant).allowed).toBe(false);
    expect(h.onboarding.recordBillingFromStripe).toHaveBeenCalledWith(expect.objectContaining({ eligible: false }));
    expect(h.control.restoreAfterPayment).not.toHaveBeenCalled();
  });

  it('persists paid evidence for the mapped subscription and restores billing suspensions', async () => {
    const h = harness();
    Object.assign(h.invoice, { status: 'paid', amount_paid: 49900 });
    await h.service.reconcileSubscription(h.subscription, h.tenant.id);
    expect(h.tenant.paymentConfirmedAt).toBeInstanceOf(Date);
    expect(h.tenant.paidSubscriptionId).toBe('sub_1');
    expect(billingEligibility(h.tenant).allowed).toBe(true);
    expect(h.control.restoreAfterPayment).toHaveBeenCalledWith('tenant-1');
    const first = h.tenant.paymentConfirmedAt;
    await h.service.reconcileSubscription(h.subscription, h.tenant.id);
    expect(h.tenant.paymentConfirmedAt).toEqual(first);
  });

  it.each(['customer', 'subscription'])('rejects invoice %s mismatches as payment evidence', async (field) => {
    const h = harness(); Object.assign(h.invoice, { status: 'paid', amount_paid: 49900 });
    if (field === 'customer') h.invoice.customer = 'cus_other';
    else h.invoice.parent.subscription_details.subscription = 'sub_other';
    await h.service.reconcileSubscription(h.subscription, h.tenant.id);
    expect(billingEligibility(h.tenant).allowed).toBe(false);
  });

  it('rejects a cross-workspace subscription before updating billing', async () => {
    const h = harness(); h.subscription.customer = 'cus_other';
    await expect(h.service.reconcileSubscription(h.subscription, h.tenant.id)).rejects.toThrow('does not belong');
    expect(h.tenants.updateBilling).not.toHaveBeenCalled();
  });

  it('never grants an unpaid trial or a canceled subscription access', async () => {
    const h = harness(); h.subscription.status = 'trialing';
    await h.service.reconcileSubscription(h.subscription, h.tenant.id);
    expect(billingEligibility(h.tenant).allowed).toBe(false);
    h.subscription.status = 'canceled';
    await h.service.reconcileSubscription(h.subscription, h.tenant.id);
    expect(billingEligibility(h.tenant).allowed).toBe(false);
  });
});
