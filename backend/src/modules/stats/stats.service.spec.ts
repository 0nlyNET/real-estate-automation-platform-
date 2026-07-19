import { StatsService } from './stats.service';

function builder(result: { count?: number; rawOne?: any; rawMany?: any[] }) {
  const value: any = {};
  for (const method of [
    'leftJoin',
    'innerJoin',
    'select',
    'addSelect',
    'where',
    'andWhere',
    'groupBy',
    'orderBy',
    'limit',
  ]) {
    value[method] = jest.fn(() => value);
  }
  value.getCount = jest.fn().mockResolvedValue(result.count || 0);
  value.getRawOne = jest.fn().mockResolvedValue(result.rawOne || {});
  value.getRawMany = jest.fn().mockResolvedValue(result.rawMany || []);
  return value;
}

describe('truthful reporting metrics', () => {
  it('separates created, attempted, provider accepted, sent, delivered, and failed states', async () => {
    const leadBuilders = [
      builder({ count: 2 }),
      builder({ rawOne: { avg: '45', count: '2' } }),
      builder({ rawOne: { avg: '120', count: '4', within5: '3' } }),
      builder({ count: 1 }),
      builder({ count: 3 }),
      builder({ rawMany: [{ label: 'new', count: '5' }] }),
      builder({ rawMany: [{ label: 'Website', count: '2' }] }),
    ];
    const messageBuilder = builder({
      rawOne: {
        created: '10',
        attempted: '8',
        providerAccepted: '5',
        sent: '3',
        delivered: '2',
        failed: '2',
        skipped: '1',
        canceled: '1',
        replies: '4',
      },
    });
    const service = new StatsService(
      {} as any,
      {
        count: jest.fn().mockResolvedValue(12),
        createQueryBuilder: jest.fn(() => leadBuilders.shift()),
      } as any,
      { createQueryBuilder: jest.fn(() => messageBuilder) } as any,
      { createQueryBuilder: jest.fn(() => builder({ count: 1 })) } as any,
      { createQueryBuilder: jest.fn(() => builder({ count: 2 })) } as any,
      { findOne: jest.fn().mockResolvedValue({ timeZone: 'America/New_York' }) } as any,
    );

    const report = await service.overview(
      'tenant-a',
      { userId: 'owner-a', role: 'owner' },
      { from: '2026-07-01T00:00:00Z', to: '2026-07-08T00:00:00Z' },
    );
    expect(report.messageMetrics).toEqual({
      created: 10,
      attempted: 8,
      providerAccepted: 5,
      sent: 3,
      delivered: 2,
      failed: 2,
      skipped: 1,
      canceled: 1,
    });
    expect(report.appointmentSetEvents).toBe(2);
    expect(report.currentAppointments).toBe(1);
    expect(report.verifiedBookings).toBeNull();
    expect(report.pctContactedWithin5Min).toBe(75);
    expect(report.reporting.statusDefinitions.delivered).toContain('delivery callback');
    expect(messageBuilder.addSelect).toHaveBeenCalledWith(
      "COUNT(*) FILTER (WHERE message.direction = 'outbound' AND message.status = 'delivered')",
      'delivered',
    );
    expect(messageBuilder.where).toHaveBeenCalledWith(
      'lead.tenantId = :tenantId',
      expect.objectContaining({ tenantId: 'tenant-a' }),
    );
  });
});
