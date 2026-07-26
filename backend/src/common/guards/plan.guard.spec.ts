import { ForbiddenException } from '@nestjs/common';
import { ServiceAccessGuard } from './plan.guard';

const context = {
  getHandler: () => function handler() {},
  getClass: () => class Controller {},
  switchToHttp: () => ({ getRequest: () => ({ user: { tenantId: 'tenant-1' } }) }),
} as any;

describe('ServiceAccessGuard', () => {
  it('uses the current tenant record instead of trusting JWT plan claims', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as any;
    const repo = { findOne: jest.fn().mockResolvedValue({ id: 'tenant-1', plan: 'service', status: 'active' }) } as any;
    await expect(new ServiceAccessGuard(reflector, repo).canActivate(context)).resolves.toBe(true);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'tenant-1' } });
  });

  it('does not create plan tiers but still denies a canceled workspace', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as any;
    const repo = { findOne: jest.fn().mockResolvedValue({ id: 'tenant-1', plan: 'service', status: 'canceled' }) } as any;
    await expect(new ServiceAccessGuard(reflector, repo).canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
