import { ComplianceService } from './compliance.service';

function createService(optRepo: Record<string, jest.Mock>) {
  const evtRepo = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  return {
    evtRepo,
    service: new ComplianceService(
      optRepo as any,
      evtRepo as any,
      {} as any,
      {} as any,
    ),
  };
}

describe('ComplianceService opt-outs', () => {
  it('treats a unique collision as an idempotent existing opt-out', async () => {
    const existing = { id: 'opt-1', tenantId: 'tenant-1', channel: 'sms', value: '15555550100' };
    const optRepo = {
      create: jest.fn((value) => value),
      save: jest.fn().mockRejectedValue({ code: '23505' }),
      findOne: jest.fn().mockResolvedValue(existing),
    };
    const { service, evtRepo } = createService(optRepo);
    await expect(
      service.addOptOut('tenant-1', 'sms', '+1 (555) 555-0100'),
    ).resolves.toBe(existing);
    expect(evtRepo.save).not.toHaveBeenCalled();
  });

  it('does not hide unrelated database failures', async () => {
    const failure = Object.assign(new Error('database unavailable'), { code: '08006' });
    const optRepo = {
      create: jest.fn((value) => value),
      save: jest.fn().mockRejectedValue(failure),
      findOne: jest.fn(),
    };
    const { service } = createService(optRepo);
    await expect(
      service.addOptOut('tenant-1', 'sms', '+15555550100'),
    ).rejects.toBe(failure);
  });
});
