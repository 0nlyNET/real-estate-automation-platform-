import {
  assertProductionEnvironment,
  environmentReadiness,
} from './environment-readiness';

describe('production configuration contract', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('reports missing configuration by variable name without exposing values', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'short';
    process.env.INTEGRATIONS_ENCRYPTION_KEY = 'invalid';
    delete process.env.DATABASE_URL;
    const report = environmentReadiness();
    expect(report.platform.status).toBe('down');
    expect(report.encryption.status).toBe('down');
    expect(JSON.stringify(report)).toContain('DATABASE_URL');
    expect(JSON.stringify(report)).not.toContain('postgres://');
    expect(() => assertProductionEnvironment()).toThrow('Unsafe production configuration');
  });

  it('accepts a complete critical production configuration and validates optional Stripe as a unit', () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://configured-but-never-returned',
      FRONTEND_URL: 'https://app.example.com',
      PUBLIC_APP_URL: 'https://app.example.com',
      PUBLIC_API_URL: 'https://api.example.com',
      PLATFORM_ADMIN_EMAILS: 'operator@example.com',
      GLOBAL_AUTOMATIONS_DISABLED: 'true',
      BILLING_GRACE_DAYS: '0',
      TWILIO_WEBHOOK_URL: 'https://api.example.com/webhooks/twilio/inbound',
      TWILIO_STATUS_CALLBACK_URL: 'https://api.example.com/webhooks/twilio/status',
      SENDGRID_SENDING_DOMAIN: 'send.example.com',
      SENDGRID_REPLY_DOMAIN: 'reply.example.com',
      TYPEORM_SYNC: 'false',
      JWT_SECRET: 'x'.repeat(32),
      INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'),
      STRIPE_SECRET_KEY: 'configured',
    });
    const report = environmentReadiness();
    expect(() => assertProductionEnvironment()).not.toThrow();
    expect(report.platform.status).toBe('up');
    expect(report.encryption.status).toBe('up');
    expect(report.billing).toMatchObject({ enabled: true, status: 'down' });
    expect(report.billing.missing).toContain('STRIPE_WEBHOOK_SECRET');
    expect(report.systemEmail.status).toBe('not_configured');
  });

  it('allows system email to be intentionally deferred but rejects partial setup', () => {
    process.env.NODE_ENV = 'production';
    for (const name of [
      'SENDGRID_API_KEY',
      'SENDGRID_FROM_EMAIL',
      'SENDGRID_FROM_NAME',
      'SALES_INBOX_EMAIL',
    ]) delete process.env[name];
    expect(environmentReadiness().systemEmail.status).toBe('not_configured');

    process.env.SENDGRID_FROM_EMAIL = 'hello@example.com';
    expect(environmentReadiness().systemEmail.status).toBe('down');
  });

  it('rejects swapped or malformed VAPID keys without exposing their values', () => {
    process.env.VAPID_PUBLIC_KEY = Buffer.alloc(32, 1).toString('base64url');
    process.env.VAPID_PRIVATE_KEY = Buffer.alloc(65, 2).toString('base64url');
    process.env.VAPID_SUBJECT = 'realtytechai@example.com';

    const report = environmentReadiness();
    expect(report.devicePush.status).toBe('down');
    expect(report.devicePush.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('VAPID_PUBLIC_KEY'),
      expect.stringContaining('VAPID_PRIVATE_KEY'),
      expect.stringContaining('VAPID_SUBJECT'),
    ]));
    expect(JSON.stringify(report)).not.toContain(process.env.VAPID_PUBLIC_KEY);
    expect(JSON.stringify(report)).not.toContain(process.env.VAPID_PRIVATE_KEY);
  });

  it('accepts a correctly shaped VAPID configuration', () => {
    process.env.VAPID_PUBLIC_KEY = Buffer.alloc(65, 1).toString('base64url');
    process.env.VAPID_PRIVATE_KEY = Buffer.alloc(32, 2).toString('base64url');
    process.env.VAPID_SUBJECT = 'mailto:alerts@example.com';

    expect(environmentReadiness().devicePush).toMatchObject({
      status: 'up',
      missing: [],
      issues: [],
    });
  });
});
