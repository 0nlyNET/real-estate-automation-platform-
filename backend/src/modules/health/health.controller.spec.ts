import { HealthController } from './health.controller';

describe('HealthController readiness', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  function configuredRuntime() {
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
      HEALTH_CHECK_TOKEN: 'h'.repeat(32),
      INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'),
    });
    for (const name of [
      'TWILIO_PRIMARY_CUSTOMER_PROFILE_SID',
      'TWILIO_SECONDARY_PROFILE_POLICY_SID',
      'TWILIO_A2P_TRUST_PRODUCT_POLICY_SID',
      'EXTERNAL_UPTIME_MONITOR_URL',
    ]) delete process.env[name];
  }

  function controller() {
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
    return new HealthController(dataSource as never, schema as never);
  }

  it('stays operationally ready while external launch approvals remain outstanding', async () => {
    configuredRuntime();
    const response = { status: jest.fn() };

    const report = await controller().readiness(
      process.env.HEALTH_CHECK_TOKEN,
      response as never,
    );

    expect(response.status).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      status: 'ready',
      configuration: {
        runtime: { status: 'up' },
        platform: { status: 'down' },
      },
    });
  });

  it('returns 503 when safe runtime configuration is incomplete', async () => {
    configuredRuntime();
    delete process.env.DATABASE_URL;
    const response = { status: jest.fn() };

    const report = await controller().readiness(
      process.env.HEALTH_CHECK_TOKEN,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(503);
    expect(report).toMatchObject({
      status: 'not_ready',
      configuration: { runtime: { status: 'down' } },
    });
  });

  it('does not disclose detailed production health without the monitor token', async () => {
    configuredRuntime();
    await expect(
      controller().readiness(undefined, { status: jest.fn() } as never),
    ).rejects.toThrow('Detailed health check is protected');
  });

  it('keeps the public health endpoint minimal', () => {
    configuredRuntime();
    expect(controller().check()).toEqual({
      status: 'up',
      process: { status: 'up' },
    });
  });
});
