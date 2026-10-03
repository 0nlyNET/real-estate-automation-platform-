import { ForbiddenException } from '@nestjs/common';
import { ServiceAccessGuard } from './plan.guard';

const context = {
  getHandler: () => function handler() {},
  getClass: () => class Controller {},
  switchToHttp: () => ({ getRequest: () => ({ user: { tenantId: 'tenant-1' } }) }),
} as any;

describe('ServiceAccessGuard', () => {
  const mockOperatorTestGuard = {
    checkTenantAuthorization: jest.fn().mockResolvedValue(null),
  } as any;

  it('uses the current tenant record instead of trusting JWT plan claims', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as any;
    const repo = { findOne: jest.fn().mockResolvedValue({ id: 'tenant-1', plan: 'service', status: 'active', paymentConfirmedAt: new Date(), stripeSubscriptionId: 'sub_1', paidSubscriptionId: 'sub_1' }) } as any;
    await expect(new ServiceAccessGuard(reflector, repo, mockOperatorTestGuard).canActivate(context)).resolves.toBe(true);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'tenant-1' } });
  });

  it('does not create plan tiers but still denies a canceled workspace', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as any;
    const repo = { findOne: jest.fn().mockResolvedValue({ id: 'tenant-1', plan: 'service', status: 'canceled' }) } as any;
    await expect(new ServiceAccessGuard(reflector, repo, mockOperatorTestGuard).canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails closed when operator test guard denies', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as any;
    // Tenant with no billing eligibility
    const repo = { findOne: jest.fn().mockResolvedValue({ id: 'tenant-1', plan: 'service', status: 'active', lifecycleStatus: 'ACTIVE' }) } as any;
    // Guard returns null (no valid grant)
    const denyGuard = { checkTenantAuthorization: jest.fn().mockResolvedValue(null) } as any;
    await expect(new ServiceAccessGuard(reflector, repo, denyGuard).canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows operator test when grant is valid', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as any;
    const repo = { findOne: jest.fn().mockResolvedValue({ id: 'tenant-1', plan: 'service', status: 'active', lifecycleStatus: 'ACTIVE' }) } as any;
    const allowGuard = { checkTenantAuthorization: jest.fn().mockResolvedValue({ id: 'grant-1' }) } as any;
    const ctx = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => ({ user: { tenantId: 'tenant-1' } }) }),
    } as any;
    await expect(new ServiceAccessGuard(reflector, repo, allowGuard).canActivate(ctx)).resolves.toBe(true);
  });
});
