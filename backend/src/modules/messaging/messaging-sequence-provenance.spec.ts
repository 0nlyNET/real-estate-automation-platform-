import { Lead } from '../leads/lead.entity';
import { Message } from './message.entity';
import { MessagingService } from './messaging.service';

/**
 * Regression: enrollment provenance is revalidated immediately before
 * provider submission.
 *
 * Scenario: queue a sequence follow-up -> inbound reply stops the enrollment
 * -> the dispatcher must suppress the old follow-up (cancel, never submit)
 * while a correct AI reply to the new inbound remains allowed.
 */
function buildService(options: {
  dataSource?: any;
  messageRepo?: any;
  leadRepo?: any;
  eventRepo?: any;
  sequencesService?: any;
  sendEmail?: jest.Mock;
} = {}) {
  const dataSource = {
    transaction: jest.fn(async (callback: any) => callback(options.dataSource?.manager || {
      query: jest.fn().mockResolvedValue([]),
    })),
    createQueryRunner: jest.fn(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      release: jest.fn().mockResolvedValue(undefined),
    })),
    ...(options.dataSource || {}),
  };
  const service = new MessagingService(
    dataSource,
    options.messageRepo || {},
    options.leadRepo || ({} as any),
    {} as any,
    options.eventRepo || {},
    {} as any,
    options.sequencesService || ({} as any),
    {
      communicationEligibility: jest.fn().mockResolvedValue({ allowed: true }),
      getQuietHours: jest.fn().mockResolvedValue({ enabled: false }),
    } as any,
    {
      evaluateMessageSafety: jest
        .fn()
        .mockResolvedValue({ allowed: true, reasons: [], ruleIds: [] }),
    } as any,
    { createTask: jest.fn() } as any,
    {
      runAiSendExclusive: jest.fn(
        async (_tenantId: string, _leadId: string, _messageId: string, callback: () => Promise<any>) => ({
          allowed: true,
          result: await callback(),
        }),
      ),
      markWaitingForHuman: jest.fn().mockResolvedValue({}),
    } as any,
    undefined,
    undefined,
    undefined,
    {
      resolveTwilio: jest.fn(),
      resolveSendGrid: jest.fn(),
    } as any,
    undefined,
    undefined,
  );
  if (options.sendEmail) (service as any).sendEmail = options.sendEmail;
  return service;
}

function setup(message: Message, enrollmentStatus: string | null) {
  const lead = Object.assign(new Lead(), {
    id: 'lead-1',
    tenantId: 'tenant-1',
    email: 'lead@example.com',
  });
  message.lead = lead;
  const manager = {
    query: jest.fn(async (sql: string) =>
      sql.includes("AND status = 'sending'") ? [] : [{ id: message.id }],
    ),
  };
  const messageRepo = {
    findOne: jest.fn().mockResolvedValue(message),
    save: jest.fn(async (value: Message) => value),
  };
  const leadRepo = { save: jest.fn(async (value: Lead) => value) };
  const eventRepo = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const sequencesService = {
    getSequenceEnrollmentStatus: jest.fn().mockResolvedValue(enrollmentStatus),
  };
  const sendEmail = jest.fn().mockResolvedValue({
    providerMessageId: 'provider-1',
    providerStatus: 'accepted',
  });
  const service = buildService({
    dataSource: {
      manager,
      transaction: jest.fn(async (callback: any) => callback(manager)),
    },
    messageRepo,
    leadRepo,
    eventRepo,
    sequencesService,
    sendEmail,
  });
  return { service, message, messageRepo, sequencesService, sendEmail, manager };
}

const ENROLLMENT_ID = '12345678-1234-1234-1234-1234567890ab';

function sequenceMessage(): Message {
  return Object.assign(new Message(), {
    id: 'message-seq-1',
    leadId: 'lead-1',
    channel: 'email',
    direction: 'outbound',
    body: 'Follow-up nudge',
    status: 'sending',
    attemptCount: 0,
    authorship: 'template',
    communicationType: 'sequence',
    idempotencyKey: `sequence:${ENROLLMENT_ID}:1:email:v2`,
    lockedBy: 'message-worker',
  });
}

function aiReplyMessage(): Message {
  return Object.assign(new Message(), {
    id: 'message-ai-1',
    leadId: 'lead-1',
    channel: 'email',
    direction: 'outbound',
    body: 'Thanks for your reply — here is what I found.',
    status: 'sending',
    attemptCount: 0,
    authorship: 'ai',
    communicationType: 'email',
    idempotencyKey: 'ai:run-1',
    lockedBy: 'message-worker',
  });
}

describe('dispatch-path enrollment provenance', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('cancels a sequence follow-up whose enrollment was stopped; never submits', async () => {
    const message = sequenceMessage();
    const { service, sequencesService, sendEmail } = setup(message, 'stopped');

    await expect(
      service.processPendingOutbound({ limit: 1 }),
    ).resolves.toEqual({ claimed: 1, recovered: 0 });

    expect(sequencesService.getSequenceEnrollmentStatus).toHaveBeenCalledWith(
      'tenant-1',
      'lead-1',
      ENROLLMENT_ID,
    );
    expect(sendEmail).not.toHaveBeenCalled();
    expect(message).toMatchObject({
      status: 'canceled',
      errorCode: 'ENROLLMENT_STOPPED',
      lockedBy: null,
    });
    expect(message.canceledAt).toBeInstanceOf(Date);
  });

  it('releases a sequence follow-up back to queued when the enrollment is paused', async () => {
    const message = sequenceMessage();
    const { service, sendEmail } = setup(message, 'paused');

    await expect(
      service.processPendingOutbound({ limit: 1 }),
    ).resolves.toEqual({ claimed: 1, recovered: 0 });

    // Paused is "not now", not "never": the step survives for a later resume.
    expect(sendEmail).not.toHaveBeenCalled();
    expect(message).toMatchObject({ status: 'queued', lockedBy: null });
  });

  it('submits a sequence follow-up while its enrollment is still active', async () => {
    const message = sequenceMessage();
    const { service, sendEmail } = setup(message, 'active');

    await expect(
      service.processPendingOutbound({ limit: 1 }),
    ).resolves.toEqual({ claimed: 1, recovered: 0 });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(message).toMatchObject({
      status: 'provider_accepted',
      providerMessageId: 'provider-1',
    });
  });

  it('still delivers an AI reply to the new inbound after the enrollment stopped', async () => {
    const message = aiReplyMessage();
    const { service, sequencesService, sendEmail } = setup(message, 'stopped');

    await expect(
      service.processPendingOutbound({ limit: 1 }),
    ).resolves.toEqual({ claimed: 1, recovered: 0 });

    // Provenance only gates sequence-owned messages; the AI reply to the
    // inbound that stopped the enrollment must still go out.
    expect(sequencesService.getSequenceEnrollmentStatus).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(message).toMatchObject({
      status: 'provider_accepted',
      providerMessageId: 'provider-1',
    });
  });

  it('cancels when the sequence enrollment no longer exists', async () => {
    const message = sequenceMessage();
    const { service, sendEmail } = setup(message, null);

    await expect(
      service.processPendingOutbound({ limit: 1 }),
    ).resolves.toEqual({ claimed: 1, recovered: 0 });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(message).toMatchObject({
      status: 'canceled',
      errorCode: 'ENROLLMENT_STOPPED',
    });
  });
});
