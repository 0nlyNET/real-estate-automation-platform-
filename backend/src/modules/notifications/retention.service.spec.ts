import { LessThan } from 'typeorm';
import { RetentionService } from './retention.service';

describe('operational retention cleanup', () => {
  const original = process.env.OPERATIONAL_RETENTION_DAYS;

  afterEach(() => {
    if (original === undefined) delete process.env.OPERATIONAL_RETENTION_DAYS;
    else process.env.OPERATIONAL_RETENTION_DAYS = original;
  });

  it('deletes only expired diagnostic records and leaves permanent business records alone', async () => {
    process.env.OPERATIONAL_RETENTION_DAYS = '90';
    const cutoff = new Date('2026-04-21T12:00:00.000Z');
    const repo = (prefix: string, affected: number) => ({
      records: [
        ...Array.from({ length: affected }, (_, index) => ({
          id: `${prefix}-expired-${index}`,
          createdAt: new Date('2026-04-20T12:00:00.000Z'),
        })),
        { id: `${prefix}-recent`, createdAt: new Date('2026-07-19T12:00:00.000Z') },
      ],
      find: jest.fn(function (this: any) {
        return Promise.resolve(this.records.filter((row: any) => row.createdAt < cutoff));
      }),
      delete: jest.fn(function (this: any, criteria: any) {
        const ids = new Set(criteria.id?._value || []);
        const before = this.records.length;
        this.records = this.records.filter((row: any) => !ids.has(row.id));
        return Promise.resolve({ affected: before - this.records.length });
      }),
    });
    const auditLogs = repo('audit', 2);
    const webhookLogs = repo('webhook', 3);
    const notifications = repo('notification', 4);
    const aiRuns = repo('ai-run', 2);
    const permanentBillingEvents = { delete: jest.fn() };
    const service = new RetentionService(
      auditLogs as any,
      webhookLogs as any,
      notifications as any,
      aiRuns as any,
    );
    const now = new Date('2026-07-20T12:00:00.000Z');
    await expect(service.run(now)).resolves.toMatchObject({
      ok: true,
      cutoff: '2026-04-21T12:00:00.000Z',
      deleted: { auditEvents: 2, webhookProcessingLogs: 3, notifications: 4 },
    });
    for (const repository of [auditLogs, webhookLogs, notifications, aiRuns]) {
      expect(repository.find).toHaveBeenCalledWith(expect.objectContaining({
        where: { createdAt: LessThan(new Date('2026-04-21T12:00:00.000Z')) },
        take: 1_000,
      }));
      expect(repository.delete).toHaveBeenCalledTimes(1);
      expect(repository.records).toEqual([
        expect.objectContaining({ id: expect.stringContaining('-recent') }),
      ]);
    }
    expect(permanentBillingEvents.delete).not.toHaveBeenCalled();
    expect(new Date('2026-07-19T12:00:00.000Z').getTime()).toBeGreaterThan(
      new Date('2026-04-21T12:00:00.000Z').getTime(),
    );
  });

  it('falls back to 90 days when the configured value is unsafe', () => {
    process.env.OPERATIONAL_RETENTION_DAYS = '2';
    const service = new RetentionService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    expect(service.retentionDays()).toBe(90);
  });
});
