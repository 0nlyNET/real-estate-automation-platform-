import { UnauthorizedException } from '@nestjs/common';
import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Message } from '../messaging/message.entity';
import { WebhooksService } from './webhooks.service';

describe('SendGrid inbound email webhook', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.SENDGRID_INBOUND_USERNAME = 'sendgrid-inbound';
    process.env.SENDGRID_INBOUND_PASSWORD = 'strong-test-password';
  });

  afterEach(() => {
    process.env = { ...original };
  });

  function build(options?: { stop?: boolean; duplicate?: boolean }) {
    const lead = Object.assign(new Lead(), {
      id: '00000000-0000-4000-8000-000000000020',
      tenantId: '00000000-0000-4000-8000-000000000001',
      fullName: 'Jordan Client',
      email: 'jordan@example.com',
      sequenceStatus: 'active',
    });
    const duplicateMessage = options?.duplicate
      ? Object.assign(new Message(), {
          id: '00000000-0000-4000-8000-000000000030',
          leadId: lead.id,
          lead,
          providerMessageId: 'sendgrid:email-123@example.com',
        })
      : null;
    const messageRepo = {
      findOne: jest.fn().mockResolvedValue(duplicateMessage),
      create: jest.fn((value) => Object.assign(new Message(), value)),
      save: jest.fn(async (value) =>
        Object.assign(value, {
          id: '00000000-0000-4000-8000-000000000030',
        }),
      ),
    };
    const leadRepo = {
      findOne: jest.fn().mockResolvedValue(lead),
      create: jest.fn((value) => Object.assign(new Lead(), value)),
      save: jest.fn(async (value) => value),
    };
    const eventRepo = {
      create: jest.fn((value) => Object.assign(new LeadEvent(), value)),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity) => {
        if (entity === Message) return messageRepo;
        if (entity === Lead) return leadRepo;
        if (entity === LeadEvent) return eventRepo;
        throw new Error('Unexpected repository');
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const credentials = {
      findOne: jest.fn().mockResolvedValue({
        provider: 'sendgrid',
        routingKey: 'replies@reply.lakeview.example',
        encryptedValue: JSON.stringify({
          connected: true,
          error: null,
          inboundAddress: 'replies@reply.lakeview.example',
        }),
        tenant: { id: lead.tenantId },
      }),
      find: jest.fn(),
    };
    const compliance = {
      isStopKeyword: jest.fn().mockReturnValue(Boolean(options?.stop)),
      addOptOut: jest.fn().mockResolvedValue({ id: 'opt-out-1' }),
    };
    const sequences = {
      stopForLead: jest.fn().mockResolvedValue(undefined),
    };
    const ai = {
      acceptInbound: jest.fn().mockResolvedValue({ status: 'queued' }),
    };
    const service = new WebhooksService(
      dataSource as any,
      credentials as any,
      compliance as any,
      sequences as any,
      { intake: jest.fn() } as any,
      ai as any,
      undefined,
      { createTask: jest.fn() } as any,
    );
    return {
      service,
      lead,
      manager,
      messageRepo,
      eventRepo,
      compliance,
      sequences,
      ai,
    };
  }

  function authorization(password = 'strong-test-password') {
    return `Basic ${Buffer.from(`sendgrid-inbound:${password}`).toString('base64')}`;
  }

  const body = {
    from: 'Jordan Client <jordan@example.com>',
    envelope: JSON.stringify({
      to: ['replies@reply.lakeview.example'],
    }),
    subject: 'Austin search',
    text: 'I would like to learn more.',
    headers:
      'Received: by mx.example\r\nMessage-ID: <email-123@example.com>\r\n',
  };

  it('authenticates, tenant-routes, stores, and queues one inbound email', async () => {
    const item = build();
    await expect(
      item.service.handleSendGridInbound(body, authorization()),
    ).resolves.toEqual({ status: 'ok' });
    expect(item.manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['sendgrid:email-123@example.com'],
    );
    expect(item.messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: item.lead.id,
        channel: 'email',
        direction: 'inbound',
        providerMessageId: 'sendgrid:email-123@example.com',
      }),
    );
    expect(item.ai.acceptInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: item.lead.tenantId,
        leadId: item.lead.id,
        channel: 'email',
      }),
    );
  });

  it('rejects an unauthenticated inbound parse request', async () => {
    const item = build();
    await expect(
      item.service.handleSendGridInbound(body, authorization('wrong')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(item.messageRepo.save).not.toHaveBeenCalled();
  });

  it('deduplicates a repeated provider Message-ID without another AI job', async () => {
    const item = build({ duplicate: true });
    await expect(
      item.service.handleSendGridInbound(body, authorization()),
    ).resolves.toEqual({ status: 'duplicate' });
    expect(item.ai.acceptInbound).not.toHaveBeenCalled();
  });

  it('records an email opt-out before any model job can run', async () => {
    const item = build({ stop: true });
    const optOutBody = { ...body, text: 'UNSUBSCRIBE' };
    await item.service.handleSendGridInbound(optOutBody, authorization());
    expect(item.compliance.addOptOut).toHaveBeenCalledWith(
      item.lead.tenantId,
      'email',
      'jordan@example.com',
      'unsubscribe_request',
      'sendgrid_inbound_webhook',
    );
    expect(item.sequences.stopForLead).toHaveBeenCalledWith(
      item.lead.id,
      'opt_out',
    );
    expect(
      item.compliance.addOptOut.mock.invocationCallOrder[0],
    ).toBeLessThan(item.ai.acceptInbound.mock.invocationCallOrder[0]);
  });
});
