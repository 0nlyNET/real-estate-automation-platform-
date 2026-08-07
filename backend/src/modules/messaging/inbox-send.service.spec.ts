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
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new Message(), {
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
    const messages = {
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(async (value) =>
        Object.assign(value, {
          id: '00000000-0000-4000-8000-000000000020',
          createdAt: new Date(),
        }),
      ),
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
    await expect(
      service.sendSmsToLead(tenantId, lead.id, 'Thanks for replying.', {
        userId: '00000000-0000-4000-8000-000000000030',
        role: 'agent',
      }),
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
  });
});
