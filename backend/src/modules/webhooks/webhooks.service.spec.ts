import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Message } from '../messaging/message.entity';
import { validTwilioSignature, WebhooksService } from './webhooks.service';

describe('Twilio inbound webhooks', () => {
  const originalWebhookUrl = process.env.TWILIO_WEBHOOK_URL;
  const url = 'https://example.com/webhooks/twilio/inbound';
  const authToken = '12345';

  afterEach(() => {
    if (originalWebhookUrl === undefined) delete process.env.TWILIO_WEBHOOK_URL;
    else process.env.TWILIO_WEBHOOK_URL = originalWebhookUrl;
  });

  it('matches Twilio\'s official fixed signature vector', () => {
    expect(
      validTwilioSignature(
        'https://example.com/myapp.php?foo=1&bar=2',
        {
          CallSid: 'CA1234567890ABCDE',
          Caller: '+14158675310',
          Digits: '1234',
          From: '+14158675310',
          To: '+18005551212',
        },
        '12345',
        'L/OH5YylLD5NRKLltdqwSvS0BnU=',
      ),
    ).toBe(true);
  });

  it('persists a signed reply once, records response time, and stops follow-ups', async () => {
    process.env.TWILIO_WEBHOOK_URL = url;
    const body = {
      From: '+15555550101',
      To: '+15555550100',
      Body: 'Yes, I would like a showing.',
      MessageSid: 'SM123',
      NumMedia: '0',
    };
    const lead = Object.assign(new Lead(), {
      id: 'lead-1',
      tenantId: 'tenant-1',
      phone: '15555550101',
      firstContactSentAt: new Date(Date.now() - 30_000),
      sequenceStatus: 'active',
    });
    const savedMessages: any[] = [];
    const messageRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => Object.assign(new Message(), value)),
      save: jest.fn(async (value) => {
        const saved = Object.assign(value, { id: 'message-1' });
        savedMessages.push(saved);
        return saved;
      }),
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
        throw new Error('Unexpected entity');
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const credentials = {
      findOne: jest.fn().mockResolvedValue({
        provider: 'twilio',
        routingKey: '+15555550100',
        encryptedValue: JSON.stringify({ connected: true, authToken }),
        tenant: { id: 'tenant-1' },
      }),
      find: jest.fn(),
    };
    const compliance = {
      isStopKeyword: jest.fn().mockReturnValue(false),
      addOptOut: jest.fn(),
    };
    const sequences = { stopForLead: jest.fn().mockResolvedValue(undefined) };
    const service = new WebhooksService(
      dataSource as any,
      credentials as any,
      compliance as any,
      sequences as any,
    );
    const signature = validSignature(body);

    await expect(
      service.handleTwilioInbound(body, { 'x-twilio-signature': signature }),
    ).resolves.toEqual({ status: 'ok' });
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['twilio:SM123'],
    );
    expect(savedMessages[0]).toMatchObject({ providerMessageId: 'SM123' });
    expect(lead.firstResponseReceivedAt).toBeInstanceOf(Date);
    expect(lead.firstResponseTimeSec).toBeGreaterThanOrEqual(29);
    expect(lead.sequenceStatus).toBe('stopped');
    expect(sequences.stopForLead).toHaveBeenCalledWith('lead-1', 'reply');
    expect(eventRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'lead_replied' }),
    );
  });

  it('replays idempotent STOP side effects after a duplicate delivery', async () => {
    process.env.TWILIO_WEBHOOK_URL = url;
    const body = {
      From: '+15555550101',
      To: '+15555550100',
      Body: 'STOP',
      MessageSid: 'SM456',
    };
    const dataSource = {
      transaction: jest.fn().mockResolvedValue({
        duplicate: true,
        tenantId: 'tenant-1',
        leadId: 'lead-1',
        stopKeyword: true,
      }),
    };
    const credentials = {
      findOne: jest.fn().mockResolvedValue({
        provider: 'twilio',
        routingKey: '+15555550100',
        encryptedValue: JSON.stringify({ connected: true, authToken }),
        tenant: { id: 'tenant-1' },
      }),
    };
    const compliance = {
      isStopKeyword: jest.fn().mockReturnValue(true),
      addOptOut: jest.fn().mockResolvedValue({ id: 'opt-1' }),
    };
    const sequences = { stopForLead: jest.fn().mockResolvedValue(undefined) };
    const service = new WebhooksService(
      dataSource as any,
      credentials as any,
      compliance as any,
      sequences as any,
    );

    await expect(
      service.handleTwilioInbound(body, {
        'x-twilio-signature': validSignature(body),
      }),
    ).resolves.toEqual({ status: 'duplicate' });
    expect(compliance.addOptOut).toHaveBeenCalledWith(
      'tenant-1',
      'sms',
      '15555550101',
      'stop_keyword',
      'twilio_webhook',
    );
    expect(sequences.stopForLead).toHaveBeenCalledWith('lead-1', 'opt_out');
  });

  function validSignature(body: Record<string, unknown>) {
    const crypto = require('crypto');
    const payload =
      url +
      Object.keys(body)
        .sort()
        .map((key) => `${key}${String(body[key] ?? '')}`)
        .join('');
    return crypto
      .createHmac('sha1', authToken)
      .update(payload)
      .digest('base64');
  }
});
