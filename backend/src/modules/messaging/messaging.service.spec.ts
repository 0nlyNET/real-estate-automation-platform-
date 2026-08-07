import { ForbiddenException } from '@nestjs/common';
import { Lead } from '../leads/lead.entity';
import { Message } from './message.entity';
import { MessagingService } from './messaging.service';

function buildService(
  options: {
    dataSource?: any;
    messageRepo?: any;
    credentialRepo?: any;
    eventRepo?: any;
    operations?: any;
    leadRepo?: any;
    compliance?: any;
    messageSafety?: any;
    aiControl?: any;
  } = {},
) {
  const dataSource = {
    transaction: jest.fn().mockResolvedValue([]),
    createQueryRunner: jest.fn(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      release: jest.fn().mockResolvedValue(undefined),
    })),
    ...(options.dataSource || {}),
  };
  return new MessagingService(
    dataSource,
    options.messageRepo || {},
    options.leadRepo || ({} as any),
    {} as any,
    options.eventRepo || {},
    options.credentialRepo || {},
    {} as any,
    options.compliance ||
      ({
        communicationEligibility: jest.fn().mockResolvedValue({ allowed: true }),
        getQuietHours: jest.fn().mockResolvedValue({ enabled: false }),
      } as any),
    options.messageSafety ||
      ({
        evaluateMessageSafety: jest
          .fn()
          .mockResolvedValue({ allowed: true, reasons: [], ruleIds: [] }),
      } as any),
    options.operations || ({ createTask: jest.fn() } as any),
    options.aiControl || {
      runAiSendExclusive: jest.fn(
        async (_tenantId, _leadId, _messageId, callback) => ({
          allowed: true,
          result: await callback(),
        }),
      ),
      markWaitingForHuman: jest.fn().mockResolvedValue({}),
    } as any,
  );
}

describe('outbound message worker safety', () => {
  const originalCallback = process.env.TWILIO_STATUS_CALLBACK_URL;
  const originalFrontendUrl = process.env.FRONTEND_URL;

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (originalCallback === undefined) delete process.env.TWILIO_STATUS_CALLBACK_URL;
    else process.env.TWILIO_STATUS_CALLBACK_URL = originalCallback;
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it('uses a leased SKIP LOCKED claim so two workers cannot claim one row', async () => {
    let available = true;
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("AND status = 'sending'")) return [];
        if (!available) return [];
        available = false;
        return [{ id: 'message-1' }];
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const messageRepo = { findOne: jest.fn().mockResolvedValue(null) };
    const first = buildService({ dataSource, messageRepo });
    const second = buildService({ dataSource, messageRepo });

    await expect(first.processPendingOutbound({ limit: 1 })).resolves.toEqual({ claimed: 1, recovered: 0 });
    await expect(second.processPendingOutbound({ limit: 1 })).resolves.toEqual({ claimed: 0, recovered: 0 });
    const sql = String((manager.query as jest.Mock).mock.calls[1][0]);
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("SET status = 'sending', locked_at = now(), locked_by = $3");
  });

  it('records the third transient provider failure as exhausted and opens an operations task', async () => {
    process.env.TWILIO_STATUS_CALLBACK_URL = 'https://api.example.com/webhooks/twilio/status';
    const lead = Object.assign(new Lead(), {
      id: 'lead-1',
      tenantId: 'tenant-1',
      phone: '15555550100',
    });
    const message = Object.assign(new Message(), {
      id: 'message-1',
      leadId: lead.id,
      lead,
      channel: 'sms',
      direction: 'outbound',
      body: 'Lakeview Realty: Hello. Reply STOP to opt out.',
      status: 'sending',
      attemptCount: 2,
      lockedBy: 'worker',
    });
    const messageRepo = {
      findOne: jest.fn().mockResolvedValue(message),
      save: jest.fn(async (value) => value),
    };
    const eventRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const credentialRepo = {
      find: jest.fn().mockResolvedValue([
        {
          provider: 'twilio',
          tenant: { id: 'tenant-1' },
          encryptedValue: JSON.stringify({
            connected: true,
            accountSid: 'AC123',
            authToken: 'secret',
            fromNumber: '+15555550101',
          }),
        },
      ]),
    };
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes("AND status = 'sending'") ? [] : [{ id: 'message-1' }],
      ),
    };
    const dataSource = { transaction: jest.fn(async (callback) => callback(manager)) };
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ message: 'provider unavailable' }),
    } as Response);
    const service = buildService({
      dataSource,
      messageRepo,
      credentialRepo,
      eventRepo,
      operations,
    });

    await expect(service.processPendingOutbound({ limit: 1 })).resolves.toEqual({ claimed: 1, recovered: 0 });
    expect(message).toMatchObject({
      status: 'failed',
      attemptCount: 3,
      errorCode: 'PROVIDER_SEND_FAILED',
      nextAttemptAt: null,
    });
    expect(message.failedAt).toBeInstanceOf(Date);
    expect(operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'messaging_failure', relatedEntityId: 'message-1' }),
    );
  });

  it('rejects direct thread substitution for a lead owned by another tenant', async () => {
    const tenantA = '00000000-0000-4000-8000-00000000000a';
    const tenantB = '00000000-0000-4000-8000-00000000000b';
    const leadB = Object.assign(new Lead(), {
      id: 'lead-b',
      tenantId: tenantB,
      assignedToUserId: 'user-b',
    });
    const leadRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        where.id === leadB.id && where.tenantId === leadB.tenantId ? leadB : null,
      ),
    };
    const messageRepo = { find: jest.fn() };
    const service = buildService({ leadRepo, messageRepo });

    await expect(
      service.getThreadMessages(tenantA, leadB.id, {
        userId: 'user-a',
        role: 'owner',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(leadRepo.findOne).toHaveBeenCalledWith({
      where: { id: leadB.id, tenantId: tenantA },
    });
    expect(messageRepo.find).not.toHaveBeenCalled();
  });

  it('does not call a provider when the final safety check blocks quiet hours', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-25T02:00:00.000Z'));
    const lead = Object.assign(new Lead(), {
      id: 'lead-quiet',
      tenantId: 'tenant-1',
      phone: '15555550100',
    });
    const message = Object.assign(new Message(), {
      id: 'message-quiet',
      leadId: lead.id,
      lead,
      channel: 'sms',
      direction: 'outbound',
      body: 'Lakeview virtual assistant: Hello.',
      status: 'sending',
      authorship: 'ai',
      attemptCount: 0,
      lockedBy: 'worker',
    });
    const messageRepo = {
      findOne: jest.fn().mockResolvedValue(message),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes("AND status = 'sending'") ? [] : [{ id: message.id }],
      ),
    };
    const lockRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const service = buildService({
      dataSource: {
        transaction: jest.fn(async (callback) => callback(manager)),
        createQueryRunner: jest.fn(() => lockRunner),
      },
      messageRepo,
      messageSafety: {
        evaluateMessageSafety: jest.fn(async () => {
          message.status = 'blocked';
          message.blockedReason =
            'Automated delivery is blocked during client quiet hours';
          Object.assign(message, { lockedAt: null, lockedBy: null });
          return {
            allowed: false,
            reasons: [message.blockedReason],
            ruleIds: ['QUIET_HOURS'],
          };
        }),
      },
    });

    await expect(
      service.processPendingOutbound({ limit: 1 }),
    ).resolves.toEqual({ claimed: 1, recovered: 0 });
    expect(message).toMatchObject({
      status: 'blocked',
      attemptCount: 0,
      lockedAt: null,
      lockedBy: null,
    });
    expect(message.blockedReason).toContain('quiet hours');
    expect(lockRunner.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_lock(hashtext($1))',
      ['service-control:tenant-1'],
    );
  });

  it('sends email with the exact tenant Reply-To and stores the SendGrid request ID', async () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    const lead = Object.assign(new Lead(), {
      id: 'lead-email',
      tenantId: 'tenant-1',
      email: 'lead@example.com',
    });
    const message = Object.assign(new Message(), {
      id: '00000000-0000-4000-8000-000000000099',
      leadId: lead.id,
      lead,
      channel: 'email',
      direction: 'outbound',
      body: 'Hello\n\nUnsubscribe: {{unsubscribeUrl}}',
      subject: 'Re: Austin search',
      inReplyToProviderMessageId: 'sendgrid:inbound-123@example.com',
      status: 'queued',
      authorship: 'human',
      attemptCount: 0,
    });
    const messageRepo = {
      findOne: jest.fn().mockResolvedValue(message),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes("AND status = 'sending'") ? [] : [{ id: message.id }],
      ),
    };
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers({ 'x-message-id': 'request-abc' }),
    } as Response);
    const service = buildService({
      dataSource: {
        transaction: jest.fn(async (callback) => callback(manager)),
      },
      messageRepo,
      leadRepo: { save: jest.fn(async (value) => value) },
      eventRepo: {
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => value),
      },
      credentialRepo: {
        find: jest.fn().mockResolvedValue([
          {
            provider: 'sendgrid',
            tenant: { id: lead.tenantId },
            routingKey: 'replies@reply.lakeview.example',
            encryptedValue: JSON.stringify({
              connected: true,
              apiKey: 'not-a-real-key',
              fromEmail: 'agent@lakeview.example',
              fromName: 'Lakeview Realty',
              inboundAddress: 'replies@reply.lakeview.example',
            }),
          },
        ]),
      },
      compliance: {
        createUnsubscribeToken: jest.fn().mockReturnValue('unsubscribe-token'),
      },
    });

    await expect(service.processPendingOutbound({ limit: 1 })).resolves.toEqual({
      claimed: 1,
      recovered: 0,
    });
    expect(message).toMatchObject({
      status: 'provider_accepted',
      providerMessageId: 'sendgrid:request-abc',
      providerStatus: 'accepted',
      attemptCount: 1,
    });
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload).toMatchObject({
      from: { email: 'agent@lakeview.example', name: 'Lakeview Realty' },
      reply_to: { email: 'replies@reply.lakeview.example' },
      subject: 'Re: Austin search',
      personalizations: [
        {
          custom_args: { rta_message_id: message.id },
          headers: {
            'In-Reply-To': '<inbound-123@example.com>',
            References: '<inbound-123@example.com>',
          },
        },
      ],
    });
  });

  it('retries an AI message only after a definitive transient provider rejection', async () => {
    process.env.TWILIO_STATUS_CALLBACK_URL =
      'https://api.example.com/webhooks/twilio/status';
    const lead = Object.assign(new Lead(), {
      id: 'lead-ai-retry',
      tenantId: 'tenant-1',
      phone: '15555550100',
    });
    const message = Object.assign(new Message(), {
      id: 'message-ai-retry',
      leadId: lead.id,
      lead,
      channel: 'sms',
      direction: 'outbound',
      body: 'Lakeview virtual assistant: Hello.',
      status: 'queued',
      authorship: 'ai',
      attemptCount: 0,
    });
    const messageRepo = {
      findOne: jest.fn().mockResolvedValue(message),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes("AND status = 'sending'") ? [] : [{ id: message.id }],
      ),
    };
    const aiControl = {
      runAiSendExclusive: jest.fn(async (_tenant, _lead, _message, callback) => ({
        allowed: true,
        result: await callback(),
      })),
      markWaitingForHuman: jest.fn(),
    };
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ message: 'Unavailable' }),
    } as Response);
    const service = buildService({
      dataSource: { transaction: jest.fn(async (callback) => callback(manager)) },
      messageRepo,
      leadRepo: { save: jest.fn() },
      credentialRepo: {
        find: jest.fn().mockResolvedValue([
          {
            provider: 'twilio',
            tenant: { id: lead.tenantId },
            encryptedValue: JSON.stringify({
              connected: true,
              accountSid: 'AC123',
              authToken: 'test',
              fromNumber: '+15555550101',
            }),
          },
        ]),
      },
      aiControl,
    });

    await service.processPendingOutbound({ limit: 1 });
    expect(message).toMatchObject({
      status: 'queued',
      attemptCount: 1,
      errorCode: 'TRANSIENT_PROVIDER_ERROR',
      providerSubmissionStartedAt: null,
    });
    expect(message.nextAttemptAt).toBeInstanceOf(Date);
    expect(aiControl.markWaitingForHuman).not.toHaveBeenCalled();
  });

  it('does not retry an ambiguous network result that could duplicate a message', async () => {
    process.env.TWILIO_STATUS_CALLBACK_URL =
      'https://api.example.com/webhooks/twilio/status';
    const lead = Object.assign(new Lead(), {
      id: 'lead-unknown',
      tenantId: 'tenant-1',
      phone: '15555550100',
    });
    const message = Object.assign(new Message(), {
      id: 'message-unknown',
      leadId: lead.id,
      lead,
      channel: 'sms',
      direction: 'outbound',
      body: 'Lakeview Realty: Hello.',
      status: 'queued',
      authorship: 'human',
      attemptCount: 0,
    });
    const messageRepo = {
      findOne: jest.fn().mockResolvedValue(message),
      save: jest.fn(async (value) => value),
    };
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes("AND status = 'sending'") ? [] : [{ id: message.id }],
      ),
    };
    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const service = buildService({
      dataSource: { transaction: jest.fn(async (callback) => callback(manager)) },
      messageRepo,
      eventRepo: {
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => value),
      },
      operations: { createTask: jest.fn().mockResolvedValue({}) },
      credentialRepo: {
        find: jest.fn().mockResolvedValue([
          {
            provider: 'twilio',
            tenant: { id: lead.tenantId },
            encryptedValue: JSON.stringify({
              connected: true,
              accountSid: 'AC123',
              authToken: 'test',
              fromNumber: '+15555550101',
            }),
          },
        ]),
      },
    });

    await service.processPendingOutbound({ limit: 1 });
    expect(message).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_RESULT_UNKNOWN',
      attemptCount: 1,
      nextAttemptAt: null,
    });
  });

  it('recovers a stale submission as unknown instead of resubmitting it', async () => {
    const lead = Object.assign(new Lead(), {
      id: 'lead-stale',
      tenantId: 'tenant-1',
    });
    const message = Object.assign(new Message(), {
      id: 'message-stale',
      leadId: lead.id,
      lead,
      channel: 'email',
      direction: 'outbound',
      status: 'sending',
      authorship: 'human',
      providerSubmissionStartedAt: new Date(Date.now() - 300_000),
    });
    const messageRepo = {
      findOne: jest.fn().mockResolvedValue(message),
      save: jest.fn(async (value) => value),
    };
    let queryCount = 0;
    const manager = {
      query: jest.fn(async () => {
        queryCount += 1;
        return queryCount === 1 ? [{ id: message.id }] : [];
      }),
    };
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
    const service = buildService({
      dataSource: { transaction: jest.fn(async (callback) => callback(manager)) },
      messageRepo,
      eventRepo: {
        create: jest.fn((value) => value),
        save: jest.fn(async (value) => value),
      },
      operations,
    });
    await expect(service.processPendingOutbound({ limit: 1 })).resolves.toEqual({
      claimed: 0,
      recovered: 1,
    });
    expect(message).toMatchObject({
      status: 'failed',
      errorCode: 'PROVIDER_RESULT_UNKNOWN',
    });
    expect(operations.createTask).toHaveBeenCalledTimes(1);
  });
});
