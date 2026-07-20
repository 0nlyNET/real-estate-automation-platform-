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
