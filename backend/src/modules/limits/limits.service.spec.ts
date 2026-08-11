import { OnboardingRecord } from '../onboarding/onboarding-record.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Tenant } from '../tenants/tenant.entity';
import { LimitsService, defaultPlatformUsagePolicy, defaultTenantUsagePolicy } from './limits.service';
import { UsageBucket } from './usage-bucket.entity';
import { UsagePolicy } from './usage-policy.entity';
import { UsageReservation } from './usage-reservation.entity';

describe('LimitsService hard limits', () => {
  it('blocks the threshold-crossing request and pauses the affected tenant', async () => {
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
    const settingsRepo = {
      findOne: jest.fn().mockResolvedValue(settings),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const tenantsRepo = {
      findOne: jest.fn().mockResolvedValue(tenant),
      save: jest.fn(async (value) => value),
    };
    const onboardingRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const pauseManager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity) => {
        if (entity === TenantSettings) return settingsRepo;
        if (entity === Tenant) return tenantsRepo;
        if (entity === OnboardingRecord) return onboardingRepo;
        throw new Error(`Unexpected pause repository: ${String(entity)}`);
      }),
    };
    const dataSource = {
      transaction: jest
        .fn()
        .mockImplementationOnce(async (callback) => callback(usageManager))
        .mockImplementationOnce(async (callback) => callback(pauseManager)),
    };
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
    const audit = { recordSystemEvent: jest.fn().mockResolvedValue({}) };
    const service = new LimitsService(
      dataSource as any,
      {} as any,
      operations as any,
      {} as any,
      audit as any,
    );

    await expect(
      service.reserveUsage({
        tenantId: 'tenant-1',
        metric: 'sms',
        idempotencyKey: 'message:one',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'USAGE_LIMIT',
      scope: 'tenant',
      metric: 'sms',
    });
    expect(reservations.save).not.toHaveBeenCalled();
    expect(settings.automationsEnabled).toBe(false);
    expect(tenant.lifecycleStatus).toBe('PAUSED');
    expect(operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'critical', category: 'usage_limit' }),
    );
    expect(audit.recordSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'automation.paused_usage_limit' }),
    );
  });
});
