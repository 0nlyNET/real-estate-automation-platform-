import { OperationsService } from './operations.service';

describe('OperationsService queue ordering and filters', () => {
  it('applies tenant/priority/overdue filters and returns critical work first', async () => {
    const now = Date.now();
    const rows: any[] = [
      {
        id: 'normal',
        priority: 'normal',
        dueAt: new Date(now - 60_000),
        createdAt: new Date(now - 60_000),
      },
      {
        id: 'critical',
        priority: 'critical',
        dueAt: null,
        createdAt: new Date(now),
      },
      {
        id: 'high',
        priority: 'high',
        dueAt: new Date(now + 60_000),
        createdAt: new Date(now),
      },
    ];
    const repo = { find: jest.fn().mockResolvedValue(rows) };
    const service = new OperationsService(repo as any);

    await expect(
      service.list({
        tenantId: 'tenant-a',
        priority: 'high',
        overdue: true,
        take: 2,
        skip: 0,
      }),
    ).resolves.toEqual([rows[1], rows[2]]);
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-a',
          priority: 'high',
          status: 'open',
          dueAt: expect.any(Object),
        }),
      }),
    );
  });
});
