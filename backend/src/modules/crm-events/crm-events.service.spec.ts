import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { encryptString } from '../../common/crypto-secrets';
import { assertSafeWebhookUrl, CrmEventsService } from './crm-events.service';

describe('CrmEventsService durable signed delivery', () => {
  const originalEnvironment = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    global.fetch = originalFetch;
  });

  it('rejects non-HTTPS, credentialed, and non-allowlisted webhook targets', () => {
    expect(() => assertSafeWebhookUrl('http://hooks.zapier.com/test')).toThrow(BadRequestException);
    expect(() => assertSafeWebhookUrl('https://user:pass@hooks.zapier.com/test')).toThrow(BadRequestException);
    expect(() => assertSafeWebhookUrl('https://127.0.0.1/test')).toThrow(BadRequestException);
    expect(assertSafeWebhookUrl('https://hooks.zapier.com/hooks/catch/1/2')).toBe('https://hooks.zapier.com/hooks/catch/1/2');
  });

  it('persists and schedules before any network delivery', async () => {
    const subscription: any = {
      id: '00000000-0000-4000-8000-000000000001', tenantId: '00000000-0000-4000-8000-000000000002',
      eventType: 'lead.created', status: 'active', targetUrl: 'https://hooks.zapier.com/hooks/catch/1/2',
    };
    const subscriptions: any = { find: jest.fn().mockResolvedValue([subscription]) };
    const deliveries: any = {
      create: jest.fn((value) => value), save: jest.fn(async (value) => Array.isArray(value)
        ? value.map((item, index) => ({ id: `00000000-0000-4000-8000-00000000001${index}`, ...item }))
        : value),
    };
    const jobs = { register: jest.fn(), schedule: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    const service = new CrmEventsService(subscriptions, deliveries, jobs as any, {} as any);
    global.fetch = jest.fn() as any;
    await expect(service.publish(subscription.tenantId, 'lead.created', { leadId: 'lead-1' })).resolves.toMatchObject({ queued: 1 });
    expect(deliveries.save).toHaveBeenCalled();
    expect(jobs.schedule).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'integration.webhook_delivery', tenantId: subscription.tenantId, maxAttempts: 10,
    }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('signs the exact timestamp and body during worker delivery', async () => {
    const signingSecret = 'rtwhsec_test-secret';
    const subscription: any = {
      id: '00000000-0000-4000-8000-000000000001', tenantId: '00000000-0000-4000-8000-000000000002',
      eventType: 'lead.created', status: 'active', targetUrl: 'https://hooks.zapier.com/hooks/catch/1/2',
      encryptedSigningSecret: encryptString(signingSecret), failureCount: 0,
      lastSuccessAt: null, lastFailureAt: null, lastError: null,
    };
    const delivery: any = {
      id: '00000000-0000-4000-8000-000000000003', tenantId: subscription.tenantId,
      subscriptionId: subscription.id, eventId: '00000000-0000-4000-8000-000000000004',
      eventType: 'lead.created', payload: { id: 'event-1', type: 'lead.created', data: { leadId: 'lead-1' } },
      status: 'scheduled', attemptCount: 0, lastHttpStatus: null, lastError: null, deliveredAt: null,
    };
    const subscriptions: any = {
      findOne: jest.fn().mockResolvedValue(subscription), save: jest.fn(async (value) => value),
    };
    const deliveries: any = {
      findOne: jest.fn().mockResolvedValue(delivery), save: jest.fn(async (value) => value),
    };
    let handler: any;
    const jobs = { register: jest.fn((_name, callback) => { handler = callback; }), schedule: jest.fn() };
    const service = new CrmEventsService(subscriptions, deliveries, jobs as any, { createTask: jest.fn() } as any);
    service.onModuleInit();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204, text: async () => '' }) as any;
    await handler({ payload: { deliveryId: delivery.id }, attemptCount: 1, maxAttempts: 10 });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.stringify(delivery.payload);
    const timestamp = init.headers['X-RealtyTechAI-Timestamp'];
    const expected = createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('hex');
    expect(url).toBe(subscription.targetUrl);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', body });
    expect(init.headers).toMatchObject({
      'X-RealtyTechAI-Event-Id': delivery.eventId,
      'X-RealtyTechAI-Event-Type': delivery.eventType,
      'X-RealtyTechAI-Signature': `v1=${expected}`,
    });
    expect(delivery).toMatchObject({ status: 'delivered', attemptCount: 1, lastHttpStatus: 204, lastError: null });
  });

  it('keeps transient failures retryable and creates an incident only after exhaustion', async () => {
    const subscription: any = {
      id: '00000000-0000-4000-8000-000000000001', tenantId: '00000000-0000-4000-8000-000000000002',
      eventType: 'lead.qualified', status: 'active', targetUrl: 'https://hooks.zapier.com/hooks/catch/1/2',
      encryptedSigningSecret: encryptString('rtwhsec_retry'), failureCount: 0,
      lastSuccessAt: null, lastFailureAt: null, lastError: null,
    };
    const delivery: any = {
      id: '00000000-0000-4000-8000-000000000003', tenantId: subscription.tenantId,
      subscriptionId: subscription.id, eventId: '00000000-0000-4000-8000-000000000004',
      eventType: subscription.eventType, payload: { id: 'event-1', type: subscription.eventType, data: {} },
      status: 'scheduled', attemptCount: 0, lastHttpStatus: null, lastError: null, deliveredAt: null,
    };
    const subscriptions: any = {
      findOne: jest.fn().mockResolvedValue(subscription), save: jest.fn(async (value) => value),
    };
    const deliveries: any = {
      findOne: jest.fn().mockResolvedValue(delivery), save: jest.fn(async (value) => value),
    };
    let handler: any;
    const jobs = { register: jest.fn((_name, callback) => { handler = callback; }), schedule: jest.fn() };
    const operations = { createTask: jest.fn().mockResolvedValue({ id: 'incident-1' }) };
    const service = new CrmEventsService(subscriptions, deliveries, jobs as any, operations as any);
    service.onModuleInit();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'temporary outage' }) as any;

    await expect(handler({ payload: { deliveryId: delivery.id }, attemptCount: 1, maxAttempts: 10 }))
      .rejects.toThrow('Webhook returned 503');
    expect(delivery).toMatchObject({ status: 'scheduled', attemptCount: 1, lastHttpStatus: 503 });
    expect(subscription.failureCount).toBe(1);
    expect(operations.createTask).not.toHaveBeenCalled();

    await expect(handler({ payload: { deliveryId: delivery.id }, attemptCount: 10, maxAttempts: 10 }))
      .rejects.toThrow('Webhook returned 503');
    expect(delivery.status).toBe('failed');
    expect(operations.createTask).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: delivery.tenantId,
      category: 'integration_delivery',
      relatedEntityId: delivery.id,
    }));
  });
});
