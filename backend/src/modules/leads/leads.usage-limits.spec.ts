import { HttpException } from '@nestjs/common';
import { LeadsService } from './leads.service';

describe('LeadsService usage reservations', () => {
  it('reserves authenticated manual leads and rejects creation when the cap is exceeded', async () => {
    const leads = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      save: jest.fn(),
    };
    const limits = {
      reserveUsage: jest.fn().mockResolvedValue({
        ok: false,
        code: 'LIMIT_LEADS',
        message: 'tenant lead safety limit reached.',
      }),
    };
    const service = new LeadsService(
      leads as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        findById: jest.fn().mockResolvedValue({
          id: 'tenant-a',
          lifecycleStatus: 'ACTIVE',
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      limits as any,
    );

    await expect(
      service.createLead('tenant-a', {
        fullName: 'Manual Lead',
        email: 'lead@example.com',
      } as any),
    ).rejects.toBeInstanceOf(HttpException);
    expect(limits.reserveUsage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a', metric: 'lead' }),
    );
    expect(leads.create).not.toHaveBeenCalled();
    expect(leads.save).not.toHaveBeenCalled();
  });
});
