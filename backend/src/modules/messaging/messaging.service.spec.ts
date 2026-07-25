import { ForbiddenException } from '@nestjs/common';
import { Lead } from '../leads/lead.entity';
import { Message } from './message.entity';
import { MessagingService } from './messaging.service';

function buildService(options: {
  dataSource?: any;
  messageRepo?: any;
  credentialRepo?: any;
  eventRepo?: any;
  operations?: any;
  leadRepo?: any;
  compliance?: any;
} = {}) {
  return new MessagingService(
    options.dataSource || { transaction: jest.fn().mockResolvedValue([]) },
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
    { evaluate: jest.fn().mockResolvedValue({ allowed: true, reasons: [] }) } as any,
    options.operations || ({ createTask: jest.fn() } as any),
    {
      runAiSendExclusive: jest.fn(
        async (_tenantId, _leadId, _messageId, callback) => ({
          allowed: true,
          result: await callback(),
        }),
      ),
    } as any,
  );
}

describe('outbound message worker safety', () => {
  const originalCallback = process.env.TWILIO_STATUS_CALLBACK_URL;

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    if (originalCallback === undefined) delete process.env.TWILIO_STATUS_CALLBACK_URL;
    else process.env.TWILIO_STATUS_CALLBACK_URL = originalCallback;
  });

  it('uses a leased SKIP LOCKED claim so two workers cannot claim one row', async () => {
    let available = true;
    const manager = {
      query: jest.fn(async () => {
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

    await expect(first.processPendingOutbound({ limit: 1 })).resolves.toEqual({ claimed: 1 });
    await expect(second.processPendingOutbound({ limit: 1 })).resolves.toEqual({ claimed: 0 });
    const sql = String((manager.query as jest.Mock).mock.calls[0][0]);
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
    const manager = { query: jest.fn().mockResolvedValue([{ id: 'message-1' }]) };
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

    await expect(service.processPendingOutbound({ limit: 1 })).resolves.toEqual({ claimed: 1 });
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

  it('rechecks quiet hours when an approved AI draft reaches the send worker', async () => {
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
      query: jest.fn().mockResolvedValue([{ id: message.id }]),
    };
    const service = buildService({
      dataSource: {
        transaction: jest.fn(async (callback) => callback(manager)),
      },
      messageRepo,
      compliance: {
        communicationEligibility: jest.fn().mockResolvedValue({ allowed: true }),
        getQuietHours: jest.fn().mockResolvedValue({
          enabled: true,
          timezone: 'UTC',
          startMinute: 0,
          endMinute: 480,
        }),
      },
    });

    await expect(
      service.processPendingOutbound({ limit: 1 }),
    ).resolves.toEqual({ claimed: 1 });
    expect(message).toMatchObject({
      status: 'queued',
      attemptCount: 0,
      lockedAt: null,
      lockedBy: null,
    });
    expect(message.scheduledAt?.toISOString()).toBe(
      '2026-07-25T08:00:00.000Z',
    );
  });
});
