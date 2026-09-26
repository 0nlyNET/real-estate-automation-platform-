import { HealthController } from './health.controller';

describe('HealthController worker health (P5)', () => {
  function baseMocks() {
    const dataSource = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM durable_jobs')) return [{ failed: '0', stalled: '0' }];
        if (sql.includes('FROM credentials')) return [{ count: '0' }];
        return [];
      }),
      showMigrations: jest.fn(async () => false),
    };
    const schema = {
      inspect: jest.fn(async () => ({ ok: true })),
      summary: jest.fn(() => ({ status: 'up' })),
    };
    return { dataSource, schema };
  }

  function configuredEnv() {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://localhost:5432/testdb',
      FRONTEND_URL: 'https://app.example.com',
      PUBLIC_APP_URL: 'https://app.example.com',
      PUBLIC_API_URL: 'https://api.example.com',
      PLATFORM_ADMIN_EMAILS: 'operator@example.com',
      GLOBAL_AUTOMATIONS_DISABLED: 'true',
      BILLING_GRACE_DAYS: '0',
      TYPEORM_SYNC: 'false',
      JWT_SECRET: 'test-jwt-secret-value-1234567890',
      HEALTH_CHECK_TOKEN: 'test-health-check-token-1234567890',
      INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'),
      EXTERNAL_UPTIME_MONITOR_URL: 'https://monitor.example.com/checks/1',
    });
  }

  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('includes a workers section with per-worker health', async () => {
    configuredEnv();
    const { dataSource, schema } = baseMocks();
    const heartbeats = {
      snapshot: jest.fn(async () => [
        {
          workerKey: 'durable_job_worker',
          displayName: 'Durable job worker (5s poll)',
          expectedIntervalSeconds: 5,
          critical: true,
          source: 'direct',
          status: 'ok',
          lastSuccessAt: new Date(),
          lastError: null,
          consecutiveFailures: 0,
          lastCheckAt: new Date(),
        },
      ]),
    };
    const controller = new HealthController(
      dataSource as never,
      schema as never,
      heartbeats as never,
    );
    const response = { status: jest.fn() };
    const report = await controller.readiness(
      process.env.HEALTH_CHECK_TOKEN,
      response as never,
    );

    expect(report.workers).toMatchObject({ status: 'up' });
    const workers = (
      report as unknown as { workers: { workers: unknown[] } }
    ).workers.workers;
    expect(workers).toHaveLength(1);
    expect(workers[0]).toMatchObject({
      workerKey: 'durable_job_worker',
      status: 'ok',
    });
    expect(response.status).not.toHaveBeenCalled();
    expect(report.status).toBe('ready');
  });

  it('returns 503 when a critical worker is stale', async () => {
    configuredEnv();
    const { dataSource, schema } = baseMocks();
    const heartbeats = {
      snapshot: jest.fn(async () => [
        {
          workerKey: 'durable_job_worker',
          displayName: 'Durable job worker (5s poll)',
          expectedIntervalSeconds: 5,
          critical: true,
          source: 'direct',
          status: 'stale',
          lastSuccessAt: new Date(Date.now() - 600_000),
          lastError: null,
          consecutiveFailures: 0,
          lastCheckAt: new Date(),
        },
      ]),
    };
    const controller = new HealthController(
      dataSource as never,
      schema as never,
      heartbeats as never,
    );
    const response = { status: jest.fn() };
    const report = await controller.readiness(
      process.env.HEALTH_CHECK_TOKEN,
      response as never,
    );

    expect(report.workers.status).toBe('down');
    expect(report.status).toBe('not_ready');
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('stays ready when the heartbeat registry is unavailable', async () => {
    configuredEnv();
    const { dataSource, schema } = baseMocks();
    const controller = new HealthController(
      dataSource as never,
      schema as never,
    );
    const response = { status: jest.fn() };
    const report = await controller.readiness(
      process.env.HEALTH_CHECK_TOKEN,
      response as never,
    );

    expect(report.workers).toMatchObject({ status: 'unknown' });
    expect(response.status).not.toHaveBeenCalled();
    expect(report.status).toBe('ready');
  });

  it('keeps the public liveness probe minimal and unauthenticated', () => {
    configuredEnv();
    const { dataSource, schema } = baseMocks();
    const controller = new HealthController(
      dataSource as never,
      schema as never,
    );
    expect(controller.live()).toEqual({
      status: 'up',
      process: { status: 'up' },
    });
  });
});
