import { TenantSettings } from '../settings/tenant-settings.entity';
import { Tenant } from '../tenants/tenant.entity';
import { LimitsService, defaultPlatformUsagePolicy, defaultTenantUsagePolicy, isHardLimitExceeded } from './limits.service';
import { UsageBucket } from './usage-bucket.entity';
import { UsagePolicy } from './usage-policy.entity';
import { UsageReservation } from './usage-reservation.entity';

describe('LimitsService hard limits', () => {
  it('allows the 60th unit and rejects the 61st', () => {
    expect(isHardLimitExceeded(59, 1, 60)).toBe(false);
    expect(isHardLimitExceeded(60, 1, 60)).toBe(true);
  });

  it('permits the configured maximum and rejects the next request', async () => {
    const tenantPolicy = Object.assign(
      new UsagePolicy(),
      defaultTenantUsagePolicy('tenant-1'),
    );
    const platformPolicy = Object.assign(
      new UsagePolicy(),
      defaultPlatformUsagePolicy(),
    );
    const reservations = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(),
    };
    const policies = {
      findOne: jest.fn(async ({ where }: any) =>
        where.scopeType === 'tenant' ? tenantPolicy : platformPolicy,
      ),
    };
    const bucketBuilder: any = {};
    for (const method of ['select', 'where', 'andWhere']) {
      bucketBuilder[method] = jest.fn(() => bucketBuilder);
    }
    bucketBuilder.getRawOne = jest.fn().mockResolvedValue({ cost: '0' });
    const buckets = {
      findOne: jest.fn(async ({ where }: any) => ({
        quantity:
          where.scopeType === 'tenant' && where.windowType === 'hour' ? 59 : 0,
      })),
      createQueryBuilder: jest.fn(() => bucketBuilder),
    };
    const usageManager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity) => {
        if (entity === UsageReservation) return reservations;
        if (entity === UsagePolicy) return policies;
        if (entity === UsageBucket) return buckets;
        throw new Error(`Unexpected usage repository: ${String(entity)}`);
      }),
    };

    const settings = Object.assign(new TenantSettings(), {
      tenantId: 'tenant-1',
      automationsEnabled: true,
    });
    const tenant = Object.assign(new Tenant(), {
      id: 'tenant-1',
      lifecycleStatus: 'ACTIVE',
    });
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(usageManager)),
    };
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
    const audit = { recordSystemEvent: jest.fn().mockResolvedValue({}) };
    const notifications = { createForPlatform: jest.fn().mockResolvedValue({}) };
    const service = new LimitsService(
      dataSource as any,
      {} as any,
      operations as any,
      notifications as any,
      audit as any,
    );

    await expect(
      service.reserveUsage({
        tenantId: 'tenant-1',
        metric: 'sms',
        idempotencyKey: 'message:one',
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(reservations.save).toHaveBeenCalled();
    expect(settings.automationsEnabled).toBe(true);
    expect(tenant.lifecycleStatus).toBe('ACTIVE');
    expect(operations.createTask).not.toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'critical' }),
    );
    expect(notifications.createForPlatform).toHaveBeenCalled();
  });
});
