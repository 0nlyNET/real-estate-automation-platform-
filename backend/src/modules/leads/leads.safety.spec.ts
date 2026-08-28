import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Lead } from './lead.entity';
import { LeadsService } from './leads.service';

function serviceFor(leads: Lead[]) {
  const leadsRepo = {
    findOne: jest.fn(async ({ where }: any) =>
      leads.find((lead) => lead.id === where.id && lead.tenantId === where.tenantId) || null),
    save: jest.fn(async (value) => value),
    find: jest.fn(async ({ where }: any) => leads.filter((lead) => lead.tenantId === where.tenantId)),
  };
  const eventsRepo = { create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
  const stageRepo = { create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
  const usersRepo = { findOne: jest.fn() };
  const teamsRepo = { findOne: jest.fn() };
  const service = new LeadsService(
    leadsRepo as any,
    eventsRepo as any,
    stageRepo as any,
    usersRepo as any,
    {} as any,
    teamsRepo as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, leadsRepo, stageRepo, usersRepo, teamsRepo };
}

describe('lead history and tenant isolation', () => {
  it('releases an unused query runner when an intake has no deduplication key', async () => {
    const runner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const service = new LeadsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      { createQueryRunner: jest.fn(() => runner) } as any,
    );
    const callback = jest.fn().mockResolvedValue('saved-without-contact');

    await expect(
      (service as any).withDedupLock(
        'tenant-a',
        undefined,
        undefined,
        undefined,
        callback,
      ),
    ).resolves.toBe('saved-without-contact');

    expect(runner.connect).toHaveBeenCalledTimes(1);
    expect(runner.query).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('records immutable stage history with tenant and actor attribution', async () => {
    const lead = Object.assign(new Lead(), {
      id: 'lead-a',
      tenantId: 'tenant-a',
      stage: 'new',
      assignedToUserId: 'user-a',
    });
    const { service, stageRepo } = serviceFor([lead]);
    await service.updateLead(
      'tenant-a',
      'lead-a',
      { stage: 'appointment_set' } as any,
      { userId: 'user-a', role: 'agent' },
    );
    expect(stageRepo.create).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      leadId: 'lead-a',
      previousStage: 'new',
      newStage: 'appointment_set',
      changedByUserId: 'user-a',
      changeSource: 'lead_update',
    });
  });

  it('prevents tenant A from reading, changing, or assigning tenant B data', async () => {
    const leadB = Object.assign(new Lead(), { id: 'lead-b', tenantId: 'tenant-b', stage: 'new' });
    const { service, usersRepo, teamsRepo } = serviceFor([leadB]);
    await expect(
      service.getLeadById('tenant-a', 'lead-b', { userId: 'owner-a', role: 'owner' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateLead('tenant-a', 'lead-b', { stage: 'contacted' } as any, {
        userId: 'owner-a',
        role: 'owner',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.assignLead({ tenantId: 'tenant-a', leadId: 'lead-b', assignedToUserId: 'user-b' }),
    ).rejects.toThrow('Lead not found');

    const ownLead = Object.assign(new Lead(), { id: 'lead-a', tenantId: 'tenant-a', stage: 'new' });
    const own = serviceFor([ownLead]);
    own.usersRepo.findOne.mockResolvedValue(null);
    await expect(
      own.service.assignLead({ tenantId: 'tenant-a', leadId: 'lead-a', assignedToUserId: 'user-b' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(own.usersRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'user-b', tenantId: 'tenant-a', isActive: true },
    });
    expect(usersRepo.findOne).not.toHaveBeenCalled();
    expect(teamsRepo.findOne).not.toHaveBeenCalled();
  });
});
