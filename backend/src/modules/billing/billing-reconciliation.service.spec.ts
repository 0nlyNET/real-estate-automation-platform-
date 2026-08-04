import { BillingReconciliationService } from './billing-reconciliation.service';
import { TenantsService } from '../tenants/tenants.service';

function tenantFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tenant-1',
    status: 'active',
    stripeCustomerId: 'cus_test',
    stripeSubscriptionId: 'sub_old',
    stripeSubscriptionStatus: 'active',
    setupPaidAt: new Date('2026-08-04T06:34:45.000Z'),
    ...overrides,
  } as any;
}

describe('BillingReconciliationService', () => {
  const originalStripeKey = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_reconciliation';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalStripeKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalStripeKey;
    }
  });

  it('repairs a stale active tenant when Stripe has no open subscription', async () => {
    const tenant = tenantFixture();
    const updateBilling = jest.fn(async (_tenantId: string, patch: any) => ({
      ...tenant,
      ...patch,
    }));
    const tenants = {
      findById: jest.fn().mockResolvedValue(tenant),
      updateBilling,
    } as unknown as TenantsService;
    const service = new BillingReconciliationService(tenants);
    (service as any).stripe = {
      subscriptions: {
        list: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'sub_old',
              status: 'canceled',
              created: 1,
              canceled_at: 1785826250,
              items: { data: [] },
            },
          ],
        }),
      },
    };

    const result = await service.reconcileTenant(tenant.id);

    expect(updateBilling).toHaveBeenCalledWith(
      tenant.id,
      expect.objectContaining({
        status: 'canceled',
        stripeSubscriptionStatus: 'canceled',
        cancelAtPeriodEnd: false,
        cancelAt: null,
        stripeCheckoutSessionId: null,
        stripeCheckoutStartedAt: null,
      }),
    );
    const patch = updateBilling.mock.calls[0][1];
    expect(patch).not.toHaveProperty('setupPaidAt');
    expect(result).toEqual(
      expect.objectContaining({
        reconciled: true,
        status: 'canceled',
        stripeSubscriptionStatus: 'canceled',
      }),
    );
  });

  it('keeps and refreshes a genuinely active Stripe subscription', async () => {
    const tenant = tenantFixture({ stripeSubscriptionId: 'sub_active' });
    const updateBilling = jest.fn(async (_tenantId: string, patch: any) => ({
      ...tenant,
      ...patch,
    }));
    const tenants = {
      findById: jest.fn().mockResolvedValue(tenant),
      updateBilling,
    } as unknown as TenantsService;
    const service = new BillingReconciliationService(tenants);
    (service as any).stripe = {
      subscriptions: {
        list: jest.fn().mockResolvedValue({
          data: [
            {
              id: 'sub_active',
              status: 'active',
              created: 2,
              cancel_at_period_end: false,
              cancel_at: null,
              items: {
                data: [
                  {
                    current_period_start: 1785825281,
                    current_period_end: 1788503681,
                  },
                ],
              },
            },
          ],
        }),
      },
    };

    const result = await service.reconcileTenant(tenant.id);

    expect(updateBilling).toHaveBeenCalledWith(
      tenant.id,
      expect.objectContaining({
        status: 'active',
        stripeSubscriptionId: 'sub_active',
        stripeSubscriptionStatus: 'active',
        cancelAtPeriodEnd: false,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        reconciled: true,
        status: 'active',
        stripeSubscriptionStatus: 'active',
      }),
    );
  });

  it('does not call Stripe for a tenant without a Stripe customer', async () => {
    const tenant = tenantFixture({
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: null,
      status: 'incomplete',
    });
    const tenants = {
      findById: jest.fn().mockResolvedValue(tenant),
      updateBilling: jest.fn(),
    } as unknown as TenantsService;
    const service = new BillingReconciliationService(tenants);
    const list = jest.fn();
    (service as any).stripe = { subscriptions: { list } };

    const result = await service.reconcileTenant(tenant.id);

    expect(list).not.toHaveBeenCalled();
    expect(result).toEqual({
      reconciled: false,
      status: 'incomplete',
      stripeSubscriptionStatus: null,
    });
  });
});
