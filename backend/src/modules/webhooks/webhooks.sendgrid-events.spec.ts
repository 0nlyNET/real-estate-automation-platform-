import { Message } from '../messaging/message.entity';
import { Lead } from '../leads/lead.entity';
import { SendGridWebhookEvent } from './sendgrid-webhook-event.entity';
import { WebhooksService } from './webhooks.service';

describe('SendGrid delivery event webhook', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.SENDGRID_INBOUND_USERNAME = 'sendgrid-events';
    process.env.SENDGRID_INBOUND_PASSWORD = 'test-password';
  });

  afterEach(() => {
    process.env = { ...original };
  });

  function authorization() {
    return `Basic ${Buffer.from('sendgrid-events:test-password').toString('base64')}`;
  }

  function harness(options?: { duplicate?: boolean }) {
    const lead = Object.assign(new Lead(), {
      id: '00000000-0000-4000-8000-000000000020',
      tenantId: '00000000-0000-4000-8000-000000000001',
      email: 'lead@example.com',
    });
    const message = Object.assign(new Message(), {
      id: '00000000-0000-4000-8000-000000000030',
      leadId: lead.id,
      lead,
      channel: 'email',
      direction: 'outbound',
      status: 'provider_accepted',
      providerStatus: 'accepted',
      providerMessageId: 'sendgrid:request-123',
    });
    const existingEvent = options?.duplicate
      ? Object.assign(new SendGridWebhookEvent(), {
          id: '00000000-0000-4000-8000-000000000040',
          providerEventId: 'event-123',
        })
      : null;
    const eventRepo = {
      findOne: jest.fn().mockResolvedValue(existingEvent),
      create: jest.fn((value) => Object.assign(new SendGridWebhookEvent(), value)),
      save: jest.fn(async (value) =>
        Object.assign(value, {
          id: value.id || '00000000-0000-4000-8000-000000000040',
        }),
      ),
    };
    const messageRepo = {
      findOne: jest.fn().mockResolvedValue(message),
      save: jest.fn(async (value) => value),
      createQueryBuilder: jest.fn(),
    };
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity) => {
        if (entity === SendGridWebhookEvent) return eventRepo;
        if (entity === Message) return messageRepo;
        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const compliance = {
      addOptOut: jest.fn().mockResolvedValue({}),
    };
    const sequences = { stopForLead: jest.fn().mockResolvedValue(undefined) };
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
    const service = new WebhooksService(
      dataSource as any,
      {} as any,
      compliance as any,
      sequences as any,
      {} as any,
      {} as any,
      messageRepo as any,
      operations as any,
    );
    return {
      service,
      lead,
      message,
      eventRepo,
      messageRepo,
      compliance,
      sequences,
      operations,
    };
  }

  function event(type: string, extra: Record<string, unknown> = {}) {
    return {
      event: type,
      sg_event_id: 'event-123',
      sg_message_id: 'request-123.filter-001',
      timestamp: 1_786_060_800,
      rta_message_id: '00000000-0000-4000-8000-000000000030',
      ...extra,
    };
  }

  it('records authenticated delivery and updates the outbound message monotonically', async () => {
    const item = harness();
    await expect(
      item.service.handleSendGridEvents([event('delivered')], authorization()),
    ).resolves.toEqual({
      status: 'ok',
      processed: 1,
      duplicates: 0,
      ignored: 0,
    });
    expect(item.message).toMatchObject({
      status: 'delivered',
      providerStatus: 'delivered',
    });
    expect(item.message.deliveredAt).toBeInstanceOf(Date);
    expect(item.eventRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: item.lead.tenantId,
        messageId: item.message.id,
        processingResult: 'updated',
      }),
    );
  });

  it('deduplicates a provider retry by sg_event_id', async () => {
    const item = harness({ duplicate: true });
    await expect(
      item.service.handleSendGridEvents([event('delivered')], authorization()),
    ).resolves.toEqual({
      status: 'ok',
      processed: 0,
      duplicates: 1,
      ignored: 0,
    });
    expect(item.messageRepo.save).not.toHaveBeenCalled();
  });

  it('marks a provider rejection failed and opens one human-visible task', async () => {
    const item = harness();
    await item.service.handleSendGridEvents(
      [event('bounce', { reason: 'Mailbox unavailable' })],
      authorization(),
    );
    expect(item.message).toMatchObject({
      status: 'failed',
      errorCode: 'SENDGRID_BOUNCE',
    });
    expect(item.operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: item.lead.tenantId,
        relatedEntityId: item.message.id,
      }),
    );
  });

  it.each(['spamreport', 'unsubscribe', 'group_unsubscribe'])(
    'applies %s as an email opt-out before further automation',
    async (eventType) => {
      const item = harness();
      await item.service.handleSendGridEvents(
        [event(eventType)],
        authorization(),
      );
      expect(item.compliance.addOptOut).toHaveBeenCalledWith(
        item.lead.tenantId,
        'email',
        item.lead.email,
        'provider_unsubscribe_event',
        'sendgrid_event_webhook',
      );
      expect(item.sequences.stopForLead).toHaveBeenCalledWith(
        item.lead.tenantId,
        item.lead.id,
        'opt_out',
      );
    },
  );
});
