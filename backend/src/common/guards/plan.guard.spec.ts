import { ForbiddenException } from '@nestjs/common';
import { TeamsPlanGuard } from './plan.guard';

const context = {
  getHandler: () => function handler() {},
  getClass: () => class Controller {},
  switchToHttp: () => ({ getRequest: () => ({ user: { tenantId: 'tenant-1' } }) }),
} as any;

describe('TeamsPlanGuard', () => {
  it('uses the current tenant record instead of trusting JWT plan claims', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as any;
    const repo = { findOne: jest.fn().mockResolvedValue({ id: 'tenant-1', plan: 'teams', status: 'active' }) } as any;
    await expect(new TeamsPlanGuard(reflector, repo).canActivate(context)).resolves.toBe(true);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'tenant-1' } });
  });

  it('denies inactive or insufficient plans', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as any;
    const repo = { findOne: jest.fn().mockResolvedValue({ id: 'tenant-1', plan: 'pro', status: 'active' }) } as any;
    await expect(new TeamsPlanGuard(reflector, repo).canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
