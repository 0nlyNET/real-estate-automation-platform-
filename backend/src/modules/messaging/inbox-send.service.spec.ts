import { ConflictException } from '@nestjs/common';
import { Lead } from '../leads/lead.entity';
import { Message } from './message.entity';
import { InboxSendService } from './inbox-send.service';

describe('manual inbox channel handling', () => {
  const originalCallback = process.env.TWILIO_STATUS_CALLBACK_URL;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalCallback === undefined) delete process.env.TWILIO_STATUS_CALLBACK_URL;
    else process.env.TWILIO_STATUS_CALLBACK_URL = originalCallback;
  });

  it('queues an email through the existing worker and switches ownership first', async () => {
    const tenantId = '00000000-0000-4000-8000-000000000001';
    const lead = Object.assign(new Lead(), {
      id: '00000000-0000-4000-8000-000000000010',
      tenantId,
      email: 'lead@example.com',
      fullName: 'Jordan Lead',
    });
    const leads = {
      findOne: jest.fn().mockResolvedValue(lead),
    };
    const messages = {
      findOne: jest.fn(async ({ where }: any) =>
        where.idempotencyKey
          ? null
          : Object.assign(new Message(), {
              subject: 'Austin homes',
              providerMessageId: 'sendgrid:inbound-123@example.com',
            }),
      ),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({
        id: '00000000-0000-4000-8000-000000000020',
        createdAt: new Date('2026-07-25T12:00:00.000Z'),
        ...value,
      })),
    };
    const credentials = {
      findOne: jest.fn().mockResolvedValue({
        provider: 'sendgrid',
        encryptedValue: JSON.stringify({
          connected: true,
          apiKey: 'server-side-test-key',
          fromEmail: 'team@example.com',
        }),
      }),
    };
    const compliance = {
      communicationEligibility: jest.fn().mockResolvedValue({ allowed: true }),
    };
    const entitlements = {
      assertAllowed: jest.fn().mockResolvedValue(undefined),
    };
    const runHumanSendExclusive = jest.fn(
      async (_tenantId, _leadId, _actor, callback) => callback(),
    );
    const service = new InboxSendService(
      leads as any,
      messages as any,
      credentials as any,
      compliance as any,
      entitlements as any,
      { createTask: jest.fn() } as any,
      { runHumanSendExclusive } as any,
    );

    await expect(
      service.queueEmailToLead(
        tenantId,
        lead.id,
        'Thanks for your message. I can help personally.',
        {
          userId: '00000000-0000-4000-8000-000000000030',
          role: 'agent',
        },
      ),
    ).resolves.toMatchObject({
      status: 'queued',
      message: {
        channel: 'email',
        authorship: 'human',
      },
    });
    expect(runHumanSendExclusive).toHaveBeenCalledTimes(1);
    expect(messages.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'queued',
        authorship: 'human',
        body: expect.stringContaining('{{unsubscribeUrl}}'),
        subject: 'Re: Austin homes',
        inReplyToProviderMessageId: 'sendgrid:inbound-123@example.com',
      }),
    );
  });

  it('queues human email with the managed SendGrid contract and no tenant credential', async () => {
    const tenantId = '00000000-0000-4000-8000-000000000001';
    const lead = Object.assign(new Lead(), {
      id: '00000000-0000-4000-8000-000000000010',
      tenantId,
      email: 'lead@example.com',
      fullName: 'Jordan Lead',
    });
    const messages = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({
        id: '00000000-0000-4000-8000-000000000020',
        createdAt: new Date(),
        ...value,
      })),
    };
    const tenantCredentials = { findOne: jest.fn().mockResolvedValue(null) };
    const providerConfig = {
      resolveSendGrid: jest.fn().mockResolvedValue({
        connected: true,
        apiKey: 'SG.server-side-only',
        fromEmail: 'sunset-00000000@send.example.com',
        fromName: 'Sunset Realty',
        inboundAddress: 'reply-token@reply.example.com',
      }),
    };
    const service = new InboxSendService(
      { findOne: jest.fn().mockResolvedValue(lead) } as any,
      messages as any,
      tenantCredentials as any,
      { communicationEligibility: jest.fn().mockResolvedValue({ allowed: true }) } as any,
      { assertAllowed: jest.fn().mockResolvedValue(undefined) } as any,
      { createTask: jest.fn() } as any,
      {
        runHumanSendExclusive: jest.fn(
          async (_tenant, _lead, _actor, callback) => callback(),
        ),
      } as any,
      undefined,
      providerConfig as any,
    );

    await expect(
      service.queueEmailToLead(tenantId, lead.id, 'I can help with your search.'),
    ).resolves.toMatchObject({
      status: 'queued',
      message: { channel: 'email', authorship: 'human' },
    });
    expect(providerConfig.resolveSendGrid).toHaveBeenCalledWith(tenantId);
    expect(tenantCredentials.findOne).not.toHaveBeenCalled();
  });

  it('queues manual SMS through the guarded worker instead of making an untracked request', async () => {
    process.env.TWILIO_STATUS_CALLBACK_URL =
      'https://api.example.com/webhooks/twilio/status';
    const tenantId = '00000000-0000-4000-8000-000000000001';
    const lead = Object.assign(new Lead(), {
      id: '00000000-0000-4000-8000-000000000010',
      tenantId,
      phone: '+15555550100',
      fullName: 'Jordan Lead',
      tenant: { name: 'Lakeview Realty' },
    });
    let savedMessage: Message | null = null;
    const messages = {
      findOne: jest.fn(async ({ where }: any) =>
        savedMessage && where.idempotencyKey === savedMessage.idempotencyKey
          ? savedMessage
          : null,
      ),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(async (value) => {
        savedMessage = Object.assign(value, {
          id: '00000000-0000-4000-8000-000000000020',
          createdAt: new Date(),
        });
        return savedMessage;
      }),
    };
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = new InboxSendService(
      { findOne: jest.fn().mockResolvedValue(lead) } as any,
      messages as any,
      {
        findOne: jest.fn().mockResolvedValue({
          encryptedValue: JSON.stringify({
            connected: true,
            accountSid: 'AC123',
            authToken: 'test',
            messagingServiceSid: 'MG123',
          }),
        }),
      } as any,
      { communicationEligibility: jest.fn().mockResolvedValue({ allowed: true }) } as any,
      { assertAllowed: jest.fn().mockResolvedValue(undefined) } as any,
      {} as any,
      {
        runHumanSendExclusive: jest.fn(
          async (_tenant, _lead, _actor, callback) => callback(),
        ),
      } as any,
    );
    const actor = {
      userId: '00000000-0000-4000-8000-000000000030',
      role: 'agent' as const,
    };
    const requestId = '00000000-0000-4000-8000-000000000040';
    await expect(
      service.sendSmsToLead(
        tenantId,
        lead.id,
        'Thanks for replying.',
        actor,
        requestId,
      ),
    ).resolves.toMatchObject({
      status: 'queued',
      message: { status: 'queued', channel: 'sms' },
    });
    expect(messages.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'queued',
        body: expect.stringContaining('Reply STOP to opt out.'),
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();

    await expect(
      service.sendSmsToLead(
        tenantId,
        lead.id,
        'Thanks for replying.',
        actor,
        requestId,
      ),
    ).resolves.toMatchObject({ status: 'queued', duplicate: true });
    expect(messages.save).toHaveBeenCalledTimes(1);

    await expect(
      service.sendSmsToLead(
        tenantId,
        lead.id,
        'This is different text.',
        actor,
        requestId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(messages.save).toHaveBeenCalledTimes(1);
  });
});
