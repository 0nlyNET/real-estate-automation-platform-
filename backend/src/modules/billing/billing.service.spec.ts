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
