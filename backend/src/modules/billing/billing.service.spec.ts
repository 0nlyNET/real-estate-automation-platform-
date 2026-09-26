import { BadRequestException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { TenantsService } from '../tenants/tenants.service';

describe('BillingService startup', () => {
  const originalStripeKey = process.env.STRIPE_SECRET_KEY;
  const tenants = {} as TenantsService;

  afterEach(() => {
    if (originalStripeKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalStripeKey;
    }
  });

  it('starts without Stripe configuration and fails only when billing is used', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const service = new BillingService(tenants);

    await expect(
      service.createPortalSession({
        tenantId: 'tenant',
        returnUrl: 'https://example.com',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('constructs the Stripe v22 CommonJS client when configured', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_startup_regression';

    expect(() => new BillingService(tenants)).not.toThrow();
  });
});

describe('BillingService trial expiry scan (P6)', () => {
  const tenants = {} as TenantsService;
  const NOW = new Date('2026-09-26T12:00:00Z');

  function scanFixture(candidates: any[]) {
    const qb: any = {};
    qb.where = jest.fn().mockReturnValue(qb);
    qb.andWhere = jest.fn().mockReturnValue(qb);
    qb.getMany = jest.fn().mockResolvedValue(candidates);
    const tenantRepo = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const notifications = { createForTenant: jest.fn().mockResolvedValue([]) };
    const service = new BillingService(
      tenants,
      undefined,
      tenantRepo as any,
      undefined,
      undefined,
      undefined,
      undefined,
      notifications as any,
    );
    return { service, notifications, tenantRepo };
  }

  const trialingTenant = (overrides: Record<string, unknown> = {}) => ({
    id: 'tenant-1',
    name: 'Acme Realty',
    status: 'trialing',
    stripeSubscriptionId: 'sub_123',
    stripeSubscriptionStatus: 'trialing',
    paymentConfirmedAt: null,
    trialEndsAt: new Date(NOW.getTime() + 3 * 86_400_000),
    ...overrides,
  });

  it('warns the client owner 3 days before the trial ends', async () => {
    const { service, notifications } = scanFixture([trialingTenant()]);
    const result = await service.runTrialExpiryScan(NOW);
    expect(result).toEqual({ scanned: 1, warned: 1 });
    expect(notifications.createForTenant).toHaveBeenCalledTimes(1);
    expect(notifications.createForTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        eventType: 'billing.trial_expiring',
        // 'billing' category routes to workspace owners only — never agents.
        category: 'billing',
        severity: 'warning',
        actionUrl: '/app/settings/billing',
        deduplicationKey: 'billing:trial-expiry:3d:tenant-1:2026-09-29',
      }),
    );
  });

  it('fires the 7-day and 1-day milestones at the right horizons', async () => {
    const seven = scanFixture([
      trialingTenant({ trialEndsAt: new Date(NOW.getTime() + 7 * 86_400_000) }),
    ]);
    await seven.service.runTrialExpiryScan(NOW);
    expect(seven.notifications.createForTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        deduplicationKey: 'billing:trial-expiry:7d:tenant-1:2026-10-03',
      }),
    );

    const one = scanFixture([
      trialingTenant({ trialEndsAt: new Date(NOW.getTime() + 1 * 86_400_000) }),
    ]);
    await one.service.runTrialExpiryScan(NOW);
    expect(one.notifications.createForTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        deduplicationKey: 'billing:trial-expiry:1d:tenant-1:2026-09-27',
        title: expect.stringContaining('1 day'),
      }),
    );

    // A 5-day trial is past the 7-day window only in the sense that the 7d
    // milestone is the next one due (smallest milestone >= days left).
    const five = scanFixture([
      trialingTenant({ trialEndsAt: new Date(NOW.getTime() + 5 * 86_400_000) }),
    ]);
    await five.service.runTrialExpiryScan(NOW);
    expect(five.notifications.createForTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        deduplicationKey: expect.stringContaining('billing:trial-expiry:7d:'),
      }),
    );
  });

  it('skips canceled, past_due, converted, and distant trials', async () => {
    const { service, notifications } = scanFixture([
      trialingTenant({ id: 't-canceled', status: 'canceled' }),
      trialingTenant({ id: 't-pastdue', status: 'past_due' }),
      trialingTenant({
        id: 't-converted',
        status: 'active',
        stripeSubscriptionStatus: 'active',
        paymentConfirmedAt: new Date(NOW.getTime() - 86_400_000),
      }),
      trialingTenant({
        id: 't-far',
        trialEndsAt: new Date(NOW.getTime() + 10 * 86_400_000),
      }),
    ]);
    const result = await service.runTrialExpiryScan(NOW);
    expect(result).toEqual({ scanned: 4, warned: 0 });
    expect(notifications.createForTenant).not.toHaveBeenCalled();
  });

  it('is a no-op without repository or notification plumbing', async () => {
    const service = new BillingService(tenants);
    await expect(service.runTrialExpiryScan(NOW)).resolves.toEqual({
      scanned: 0,
      warned: 0,
    });
  });
});
