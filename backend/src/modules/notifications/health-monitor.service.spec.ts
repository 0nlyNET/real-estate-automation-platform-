import { HealthMonitorService } from './health-monitor.service';

describe('server health incident grouping', () => {
  const original = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: 'development',
      JWT_SECRET: 'test-secret',
      INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    });
  });

  afterEach(() => { process.env = { ...original }; });

  it('does not classify pending external launch approvals as a runtime outage', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://configured-but-never-returned',
      FRONTEND_URL: 'https://app.example.com',
      PUBLIC_APP_URL: 'https://app.example.com',
      PUBLIC_API_URL: 'https://api.example.com',
      PLATFORM_ADMIN_EMAILS: 'operator@example.com',
      GLOBAL_AUTOMATIONS_DISABLED: 'true',
      BILLING_GRACE_DAYS: '0',
      TYPEORM_SYNC: 'false',
      JWT_SECRET: 'x'.repeat(32),
      INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    });
    for (const name of [
      'TWILIO_PRIMARY_CUSTOMER_PROFILE_SID',
      'TWILIO_SECONDARY_PROFILE_POLICY_SID',
      'TWILIO_A2P_TRUST_PRODUCT_POLICY_SID',
      'EXTERNAL_UPTIME_MONITOR_URL',
    ]) delete process.env[name];
    const service = new HealthMonitorService(
      { query: jest.fn().mockResolvedValue([{ ok: 1 }]) } as any,
      { count: jest.fn().mockResolvedValue(0) } as any,
      {
        createForPlatform: jest.fn(),
        incidentIsOpen: jest.fn().mockResolvedValue(false),
      } as any,
    );

    await expect(service.check()).resolves.toMatchObject({ healthy: true, reasons: [] });
  });

  it('requires three failures, sends one incident, and sends one recovery', async () => {
    const dataSource = { query: jest.fn().mockRejectedValue(new Error('offline')) };
    const stripeEvents = { count: jest.fn().mockResolvedValue(0) };
    const notifications = {
      createForPlatform: jest.fn().mockResolvedValue([]),
      incidentIsOpen: jest.fn().mockResolvedValue(false),
    };
    const service = new HealthMonitorService(dataSource as any, stripeEvents as any, notifications as any);
    const now = new Date('2026-07-20T12:00:00.000Z');
    await service.check(now);
    await service.check(now);
    expect(notifications.createForPlatform).not.toHaveBeenCalled();
    await service.check(now);
    await service.check(now);
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(1);
    expect(notifications.createForPlatform).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: 'system.health_incident', severity: 'critical' }),
    );

    dataSource.query.mockResolvedValue([{ ok: 1 }]);
    await service.check(new Date('2026-07-20T12:05:00.000Z'));
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(2);
    expect(notifications.createForPlatform).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventType: 'system.health_recovered' }),
    );
  });
});
