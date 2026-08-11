import { Message } from '../messaging/message.entity';
import { Tenant } from '../tenants/tenant.entity';
import { LimitsService } from './limits.service';
import { UsageReservation } from './usage-reservation.entity';

describe('LimitsService tenant usage reporting', () => {
  it('reports provider outcomes, estimated cost, revenue, and contribution margin', async () => {
    const builder = (rows: any[]) => ({
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rows),
    });
    const usageBuilder = builder([
      { metric: 'sms', quantity: '4', estimatedCostUsd: '0.40' },
      { metric: 'email', quantity: '3', estimatedCostUsd: '0.03' },
      { metric: 'ai', quantity: '2', estimatedCostUsd: '0.20' },
    ]);
    const messageBuilder = builder([
      { channel: 'sms', status: 'delivered', providerStatus: 'delivered', quantity: '3' },
      { channel: 'sms', status: 'failed', providerStatus: 'undelivered', quantity: '1' },
      { channel: 'email', status: 'delivered', providerStatus: 'delivered', quantity: '2' },
      { channel: 'email', status: 'failed', providerStatus: 'bounce', quantity: '1' },
    ]);
    const dataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === Tenant) {
          return {
            findOne: jest.fn().mockResolvedValue({
              id: 'tenant-a',
              stripeUnitAmount: 10000,
              stripeCurrency: 'usd',
              billingInterval: 'month',
            }),
          };
        }
        if (entity === UsageReservation) return { createQueryBuilder: jest.fn(() => usageBuilder) };
        if (entity === Message) return { createQueryBuilder: jest.fn(() => messageBuilder) };
        throw new Error(`Unexpected repository ${String(entity)}`);
      }),
    };
    const service = new LimitsService(
      dataSource as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(service.tenantUsageReport('tenant-a', 30)).resolves.toMatchObject({
      delivery: {
        sms: { sent: 3, delivered: 3, failed: 1 },
        email: { sent: 2, delivered: 2, failed: 1, bounced: 1 },
      },
      estimatedProviderCostUsd: 0.63,
      normalizedMonthlyRevenueUsd: 100,
      estimatedContributionMarginUsd: 99.37,
    });
  });
});
