import { createHmac } from 'crypto';
import { ComplianceEvent } from '../compliance/compliance-event.entity';
import { ComplianceOptOut } from '../compliance/compliance-optout.entity';
import { LeadConsentRecord } from '../compliance/lead-consent-record.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { TwilioInboundMessage } from './twilio-inbound-message.entity';
import { TwilioInboundBody, WebhooksService } from './webhooks.service';

const originalSendGridEnv = { ...process.env };
const twilioWebhookUrl =
  'https://api.example.com/api/v1/telephony/twilio/sms-callback';
const twilioAuthToken = 'test-auth-token';

function twilioSignature(body: Record<string, unknown>): string {
  const payload =
    twilioWebhookUrl +
    Object.keys(body)
      .sort()
      .map((key) => `${key}${String(body[key] ?? '')}`)
      .join('');
  return createHmac('sha1', twilioAuthToken).update(payload).digest('base64');
}

function emailHarness(options?: { stop?: boolean }) {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const lead = Object.assign(new Lead(), {
    id: '00000000-0000-4000-8000-000000000020',
    tenantId,
    fullName: 'Jordan Client',
    email: 'jordan@example.com',
    communicationStatus: 'active',
    optedOutAt: null,
    optOutSource: null,
    sequenceStatus: 'active',
  });
  const messageRepo = {
    findOne: jest.fn().mockResolvedValue(null),
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
    getRepository: jest.fn((entity) => {
      if (entity === Lead) return leadRepo;
      throw new Error('Unexpected repository');
    }),
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
      tenant: { id: tenantId },
    }),
    find: jest.fn(),
  };
  const compliance = {
    isStopKeyword: jest.fn().mockReturnValue(Boolean(options?.stop)),
    addOptOut: jest.fn().mockResolvedValue({ id: 'opt-out-1' }),
  };
  const sequences = { stopForLead: jest.fn().mockResolvedValue(undefined) };
  const ai = { acceptInbound: jest.fn().mockResolvedValue({ status: 'queued' }) };
  const service = new WebhooksService(
    dataSource as any,
    credentials as any,
    compliance as any,
    sequences as any,
    { intake: jest.fn() } as any,
    ai as any,
    undefined,
    { createTask: jest.fn() } as any,
    undefined,
    undefined,
    undefined,
    undefined,
  );
  return { service, lead, leadRepo, compliance, sequences, ai };
}

function emailAuthorization() {
  return `Basic ${Buffer.from('sendgrid-inbound:strong-test-password').toString('base64')}`;
}

function smsHarness(options: { candidates?: Lead[]; body?: string } = {}) {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const body: TwilioInboundBody = {
    From: '+14155550101',
    To: '+14155550999',
    Body: options.body ?? 'STOP',
    MessageSid: 'SM-stop-parity-1',
    MessagingServiceSid: 'MG-test',
  };
  const inboundRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) =>
      Object.assign(new TwilioInboundMessage(), value),
    ),
    save: jest.fn(async (value) =>
      Object.assign(value, { id: value.id || 'inbound-new' }),
    ),
  };
  const messageRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => Object.assign(new Message(), value)),
    save: jest.fn(async (value) =>
      Object.assign(value, { id: 'message-inbound' }),
    ),
  };
  const leadBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(options.candidates ?? []),
  };
  const leadRepository = {
    createQueryBuilder: jest.fn(() => leadBuilder),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => Object.assign(new Lead(), value)),
    save: jest.fn(async (value) => value),
  };
  const leadEventRepository = {
    create: jest.fn((value) => Object.assign(new LeadEvent(), value)),
    save: jest.fn(async (value) => value),
  };
  const optOutRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const consentRepository = {
    update: jest.fn().mockResolvedValue({ affected: 0 }),
  };
  const complianceEventRepository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: jest.fn((entity) => {
      if (entity === TwilioInboundMessage) return inboundRepository;
      if (entity === Message) return messageRepository;
      if (entity === Lead) return leadRepository;
      if (entity === LeadEvent) return leadEventRepository;
      if (entity === ComplianceOptOut) return optOutRepository;
      if (entity === LeadConsentRecord) return consentRepository;
      if (entity === ComplianceEvent) return complianceEventRepository;
      throw new Error(`Unexpected repository: ${String(entity)}`);
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (work) => work(manager)),
  };
  const credentials = {
    findOne: jest.fn().mockResolvedValue({
      provider: 'twilio',
      routingKey: body.To,
      encryptedValue: JSON.stringify({ connected: true, authToken: twilioAuthToken }),
      tenant: { id: tenantId },
    }),
    find: jest.fn().mockResolvedValue([]),
  };
  const compliance = {
    recordEvent: jest.fn().mockResolvedValue({}),
    addOptOut: jest.fn().mockResolvedValue({ id: 'opt-out-1' }),
  };
  const sequences = { stopForLead: jest.fn().mockResolvedValue(undefined) };
  const ai = { acceptInbound: jest.fn().mockResolvedValue({ status: 'queued' }) };
  const service = new WebhooksService(
    dataSource as never,
    credentials as never,
    compliance as never,
    sequences as never,
    {} as never,
    ai as never,
    undefined,
    undefined,
    undefined,
  );
  return {
    service,
    tenantId,
    body,
    compliance,
    leadRepository,
    complianceEventRepository,
  };
}

describe('M4 email STOP parity', () => {
  beforeEach(() => {
    process.env.SENDGRID_INBOUND_USERNAME = 'sendgrid-inbound';
    process.env.SENDGRID_INBOUND_PASSWORD = 'strong-test-password';
  });

  afterEach(() => {
    process.env = { ...originalSendGridEnv };
  });

  const stopBody = {
    from: 'Jordan Client <jordan@example.com>',
    envelope: JSON.stringify({
      to: ['replies@reply.lakeview.example'],
    }),
    subject: 'Austin search',
    text: 'UNSUBSCRIBE',
    headers:
      'Received: by mx.example\r\nMessage-ID: <email-123@example.com>\r\n',
  };

  const replyBody = { ...stopBody, text: 'I would like to learn more.' };

  it('marks the lead opted_out with optedOutAt and optOutSource on an email STOP', async () => {
    const item = emailHarness({ stop: true });
    await item.service.handleSendGridInbound(stopBody, emailAuthorization());
    expect(item.leadRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        communicationStatus: 'opted_out',
        optOutSource: 'sendgrid_inbound_email',
      }),
    );
    expect(item.lead.communicationStatus).toBe('opted_out');
    expect(item.lead.optedOutAt).toBeInstanceOf(Date);
    expect(item.lead.optOutSource).toBe('sendgrid_inbound_email');
    expect(item.compliance.addOptOut).toHaveBeenCalledWith(
      item.lead.tenantId,
      'email',
      'jordan@example.com',
      'unsubscribe_request',
      'sendgrid_inbound_webhook',
    );
    expect(item.ai.acceptInbound).not.toHaveBeenCalled();
  });

  it('does not change the opt-out fields for an ordinary inbound email', async () => {
    const item = emailHarness({ stop: false });
    await item.service.handleSendGridInbound(replyBody, emailAuthorization());
    expect(item.lead.communicationStatus).toBe('active');
    expect(item.lead.optOutSource).toBeNull();
    expect(item.lead.optedOutAt).toBeNull();
    expect(item.compliance.addOptOut).not.toHaveBeenCalled();
  });
});

describe('M4 STOP from an unknown sender records a compliance opt-out', () => {
  const originalUrl = process.env.TWILIO_WEBHOOK_URL;

  beforeEach(() => {
    process.env.TWILIO_WEBHOOK_URL = twilioWebhookUrl;
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.TWILIO_WEBHOOK_URL;
    else process.env.TWILIO_WEBHOOK_URL = originalUrl;
  });

  it('records a ComplianceOptOut for an unmatched SMS STOP instead of only ignoring it', async () => {
    const item = smsHarness({ candidates: [], body: 'STOP' });
    await expect(
      item.service.handleTwilioInbound(item.body, {
        'x-twilio-signature': twilioSignature(item.body),
      }),
    ).resolves.toEqual({ status: 'ignored' });

    expect(item.compliance.addOptOut).toHaveBeenCalledWith(
      item.tenantId,
      'sms',
      '14155550101',
      'stop_keyword',
      'twilio_inbound_sms',
    );
    expect(item.leadRepository.save).not.toHaveBeenCalled();
    expect(item.complianceEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'twilio_inbound_lead_not_found' }),
    );
  });

  it('does not record an opt-out when an unmatched SMS is not a STOP', async () => {
    const item = smsHarness({ candidates: [], body: 'Hello, is this available?' });
    await expect(
      item.service.handleTwilioInbound(item.body, {
        'x-twilio-signature': twilioSignature(item.body),
      }),
    ).resolves.toEqual({ status: 'ignored' });

    expect(item.compliance.addOptOut).not.toHaveBeenCalled();
  });
});
