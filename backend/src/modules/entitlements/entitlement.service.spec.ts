import { ForbiddenException } from '@nestjs/common';
import {
  billingEligibility,
  configuredBillingGraceDays,
  EntitlementService,
} from './entitlement.service';

const paid = { paymentConfirmedAt: new Date('2026-07-01'), stripeSubscriptionId: 'sub_paid', paidSubscriptionId: 'sub_paid' };

describe('central service entitlements', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('handles active, expired trial, past-due grace, and canceled billing states', () => {
    const now = new Date('2026-07-19T12:00:00Z');
    expect(billingEligibility({ ...paid, status: 'active' } as any, now).allowed).toBe(true);
    expect(
      billingEligibility(
        { status: 'trialing', trialEndsAt: new Date('2026-07-19T11:59:59Z') } as any,
        now,
      ),
    ).toMatchObject({ allowed: false, reason: 'Payment has not been confirmed by Stripe' });

    process.env.BILLING_GRACE_DAYS = '3';
    expect(configuredBillingGraceDays()).toBe(3);
    expect(
      billingEligibility(
        { ...paid, status: 'past_due', lastPaymentFailureAt: new Date('2026-07-18T12:00:00Z') } as any,
        now,
      ).allowed,
    ).toBe(true);
    expect(
      billingEligibility(
        { ...paid, status: 'past_due', lastPaymentFailureAt: new Date('2026-07-10T12:00:00Z') } as any,
        now,
      ).allowed,
    ).toBe(false);
    expect(billingEligibility({ status: 'canceled' } as any, now).allowed).toBe(false);
  });

  it.each(['incomplete', 'unpaid', 'active', 'trialing', 'past_due'])('never unlocks an unconfirmed %s account', (status) => {
    expect(billingEligibility({ status } as any).allowed).toBe(false);
  });

  it('does not reuse payment evidence for a different subscription', () => {
    expect(billingEligibility({ ...paid, status: 'active', stripeSubscriptionId: 'sub_new' } as any).allowed).toBe(false);
  });

  it('requires active lifecycle and an explicitly enabled workspace', async () => {
    const tenant = { ...paid, id: 'tenant-1', status: 'active', lifecycleStatus: 'ONBOARDING' };
    const tenants = { findOne: jest.fn().mockResolvedValue(tenant) };
    const settings = { findOne: jest.fn().mockResolvedValue({ automationsEnabled: false }) };
    const service = new EntitlementService(tenants as any, settings as any);

    await expect(service.evaluate('tenant-1', 'send_automated_sms')).resolves.toMatchObject({
      allowed: false,
      billingEligible: true,
      lifecycleEligible: false,
      automationEnabled: false,
      reasons: expect.arrayContaining([
        'Workspace lifecycle is ONBOARDING',
        'Workspace automation is disabled',
      ]),
    });
    await expect(service.assertAllowed('tenant-1', 'send_automated_sms')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows controlled human replies during onboarding or pause while automation stays blocked', async () => {
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'true';
    const tenant = { ...paid, status: 'active', lifecycleStatus: 'ONBOARDING' };
    const tenants = { findOne: jest.fn().mockImplementation(async () => tenant) };
    const service = new EntitlementService(
      tenants as any,
      { findOne: jest.fn().mockResolvedValue({ automationsEnabled: false }) } as any,
    );

    await expect(service.evaluate('tenant-1', 'send_manual_email')).resolves.toMatchObject({
      allowed: true,
      billingEligible: true,
      lifecycleEligible: true,
      automationEnabled: false,
      globalAutomationPaused: true,
      reasons: [],
    });

    tenant.lifecycleStatus = 'PAUSED';
    await expect(service.evaluate('tenant-1', 'send_manual_sms')).resolves.toMatchObject({
      allowed: true,
      lifecycleEligible: true,
      reasons: [],
    });

    await expect(service.evaluate('tenant-1', 'send_automated_email')).resolves.toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining([
        'Workspace lifecycle is PAUSED',
        'Platform automation is globally paused',
        'Workspace automation is disabled',
      ]),
    });

    tenant.lifecycleStatus = 'SUSPENDED';
    await expect(service.evaluate('tenant-1', 'send_manual_email')).resolves.toMatchObject({
      allowed: false,
      lifecycleEligible: false,
      reasons: expect.arrayContaining(['Workspace lifecycle is SUSPENDED']),
    });
  });

  it('applies the platform kill switch even to otherwise eligible automation', async () => {
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'true';
    const service = new EntitlementService(
      { findOne: jest.fn().mockResolvedValue({ ...paid, status: 'active', lifecycleStatus: 'ACTIVE' }) } as any,
      { findOne: jest.fn().mockResolvedValue({ automationsEnabled: true }) } as any,
    );
    await expect(service.evaluate('tenant-1', 'run_sequence_step')).resolves.toMatchObject({
      allowed: false,
      globalAutomationPaused: true,
      reasons: expect.arrayContaining(['Platform automation is globally paused']),
    });
  });
});
