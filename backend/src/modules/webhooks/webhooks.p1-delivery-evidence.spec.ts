import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { SendGridWebhookEvent } from './sendgrid-webhook-event.entity';
import { AiRun } from '../ai/ai-run.entity';
import { WebhooksService } from './webhooks.service';

/**
 * P1 regression coverage for delivery-evidence recording:
 * - Only the authenticated `delivered` event records delivered evidence.
 *   `processed`/`deferred` and other non-delivery events never do.
 * - aiRunId alone never marks an inbound-triggered AI reply delivered: the
 *   linked run's triggerType and triggeringMessageId are verified with full
 *   tenant/lead/channel/run ownership.
 * - SMS reply delivery comes from the Twilio status path, never SendGrid.
 */
describe('P1 delivery evidence', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.SENDGRID_INBOUND_USERNAME = 'sendgrid-events';
    process.env.SENDGRID_INBOUND_PASSWORD = 'test-password';
  });

  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  function authorization() {
    return `Basic ${Buffer.from('sendgrid-events:test-password').toString('base64')}`;
  }

  const TENANT_ID = '00000000-0000-4000-8000-000000000001';
  const LEAD_ID = '00000000-0000-4000-8000-000000000020';
  const MESSAGE_ID = '00000000-0000-4000-8000-000000000030';
  const AI_RUN_ID = '00000000-0000-4000-8000-000000000040';
  const TRIGGER_ID = '00000000-0000-4000-8000-000000000050';
  const TEST_RUN_ID = '00000000-0000-4000-8000-000000000060';

  type AiRunSetup =
    | { kind: 'none' }
    | { kind: 'missing' }
    | {
        kind: 'run';
        triggerType?: 'inbound' | 'first_response';
        triggeringMessageId?: string | null;
        tenantId?: string;
        leadId?: string;
        channel?: string;
        triggerExists?: boolean;
      };

  function harness(aiRunSetup: AiRunSetup = { kind: 'none' }) {
    const lead = Object.assign(new Lead(), {
      id: LEAD_ID,
      tenantId: TENANT_ID,
      email: 'lead@example.com',
      testRunId: TEST_RUN_ID,
    });
    const message = Object.assign(new Message(), {
      id: MESSAGE_ID,
      leadId: LEAD_ID,
      lead,
      channel: 'email',
      direction: 'outbound',
      status: 'provider_accepted',
      providerMessageId: 'sendgrid:request-123',
    });
    if (aiRunSetup.kind !== 'none') {
      (message as any).aiRunId = AI_RUN_ID;
    }
    const trigger = Object.assign(new Message(), {
      id: TRIGGER_ID,
      leadId: LEAD_ID,
      channel: 'email',
      direction: 'inbound',
      body: 'I am looking for a 3-bedroom in Elmwood Village.',
    });
    const aiRun =
      aiRunSetup.kind === 'run'
        ? Object.assign(new AiRun(), {
            id: AI_RUN_ID,
            tenantId: aiRunSetup.tenantId ?? TENANT_ID,
            leadId: aiRunSetup.leadId ?? LEAD_ID,
            triggerType: aiRunSetup.triggerType ?? 'inbound',
            triggeringMessageId:
              aiRunSetup.triggeringMessageId === undefined
                ? TRIGGER_ID
                : aiRunSetup.triggeringMessageId,
            promptMetadata: { channel: aiRunSetup.channel ?? 'email' },
          })
        : null;
    const triggerExists =
      aiRunSetup.kind === 'run' ? (aiRunSetup.triggerExists ?? true) : false;
    const eventRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => Object.assign(new SendGridWebhookEvent(), value)),
      save: jest.fn(async (value) =>
        Object.assign(value, { id: value.id || 'event-row' }),
      ),
    };
    const messageRepo = {
      findOne: jest.fn(async (options: any) => {
        const where = options?.where || {};
        if (where.id === TRIGGER_ID) {
          return where.direction === 'inbound' && triggerExists ? trigger : null;
        }
        return message;
      }),
      save: jest.fn(async (value) => value),
      createQueryBuilder: jest.fn(),
    };
    const aiRunsRepo = {
      findOne: jest.fn(async () => (aiRunSetup.kind === 'missing' ? null : aiRun)),
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
    const onboarding = {
      recordAutomatedTestEvidence: jest.fn().mockResolvedValue({}),
    };
    const service = new WebhooksService(
      dataSource as any,
      {} as any,
      { addOptOut: jest.fn(), addDeliverySuppression: jest.fn() } as any,
      { stopForLead: jest.fn() } as any,
      {} as any,
      {} as any,
      messageRepo as any,
      { createTask: jest.fn() } as any,
      onboarding as any,
      undefined,
      undefined,
      undefined,
      aiRunsRepo as any,
    );
    return { service, lead, message, onboarding, aiRunsRepo, messageRepo };
  }

  function event(type: string) {
    return {
      event: type,
      sg_event_id: `event-${type}`,
      sg_message_id: 'request-123.filter-001',
      timestamp: 1_786_060_800,
      rta_message_id: MESSAGE_ID,
    };
  }

  it('records AI-reply delivery on delivered for an inbound-triggered run', async () => {
    const item = harness({ kind: 'run' });
    await item.service.handleSendGridEvents([event('delivered')], authorization());
    expect(item.onboarding.recordAutomatedTestEvidence).toHaveBeenCalledWith(
      TENANT_ID,
      {
        outboundDelivered: true,
        testRunId: TEST_RUN_ID,
        inboundEmailAiReplyDelivered: true,
      },
    );
  });

  it.each(['processed', 'deferred'])(
    'records no delivered evidence on %s',
    async (type) => {
      const item = harness({ kind: 'run' });
      await item.service.handleSendGridEvents([event(type)], authorization());
      expect(
        item.onboarding.recordAutomatedTestEvidence,
      ).not.toHaveBeenCalled();
      // The message itself still tracks the provider state, but readiness
      // evidence is untouched.
      expect(item.message.status).not.toBe('delivered');
    },
  );

  it('does not mark an inbound reply for a first_response run', async () => {
    const item = harness({
      kind: 'run',
      triggerType: 'first_response',
      triggeringMessageId: null,
    });
    await item.service.handleSendGridEvents([event('delivered')], authorization());
    expect(item.onboarding.recordAutomatedTestEvidence).toHaveBeenCalledWith(
      TENANT_ID,
      {
        outboundDelivered: true,
        testRunId: TEST_RUN_ID,
      },
    );
    expect(
      item.onboarding.recordAutomatedTestEvidence,
    ).not.toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ inboundEmailAiReplyDelivered: true }),
    );
  });

  it('does not mark an inbound reply when the run belongs to another tenant', async () => {
    const item = harness({
      kind: 'run',
      tenantId: '00000000-0000-4000-8000-000000000099',
    });
    await item.service.handleSendGridEvents([event('delivered')], authorization());
    expect(
      item.onboarding.recordAutomatedTestEvidence,
    ).not.toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ inboundEmailAiReplyDelivered: true }),
    );
  });

  it('does not mark an inbound reply when the triggering message is missing', async () => {
    const item = harness({ kind: 'run', triggerExists: false });
    await item.service.handleSendGridEvents([event('delivered')], authorization());
    expect(
      item.onboarding.recordAutomatedTestEvidence,
    ).not.toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ inboundEmailAiReplyDelivered: true }),
    );
  });

  it('does not mark an inbound reply when the linked run is gone', async () => {
    const item = harness({ kind: 'missing' });
    await item.service.handleSendGridEvents([event('delivered')], authorization());
    expect(
      item.onboarding.recordAutomatedTestEvidence,
    ).not.toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ inboundEmailAiReplyDelivered: true }),
    );
  });

  it('records plain outbound delivery without an AI run', async () => {
    const item = harness({ kind: 'none' });
    await item.service.handleSendGridEvents([event('delivered')], authorization());
    expect(item.onboarding.recordAutomatedTestEvidence).toHaveBeenCalledWith(
      TENANT_ID,
      {
        outboundDelivered: true,
        testRunId: TEST_RUN_ID,
      },
    );
  });

  it('never records SMS reply evidence from the SendGrid path', async () => {
    const item = harness({ kind: 'run' });
    item.message.channel = 'sms';
    await item.service.handleSendGridEvents([event('delivered')], authorization());
    // The SendGrid message is email-only evidence; an SMS-channel message is
    // rejected by the outbound-email match, so no evidence is recorded.
    expect(
      item.onboarding.recordAutomatedTestEvidence,
    ).not.toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ inboundSmsAiReplyDelivered: true }),
    );
  });
});

describe('P1 Twilio SMS reply delivery', () => {
  const originalUrl = process.env.TWILIO_STATUS_CALLBACK_URL;
  const callbackUrl = 'https://api.example.com/webhooks/twilio/status';
  const authToken = 'twilio-auth-token';

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.TWILIO_STATUS_CALLBACK_URL;
    else process.env.TWILIO_STATUS_CALLBACK_URL = originalUrl;
  });

  const TENANT_ID = 'tenant-1';
  const LEAD_ID = 'lead-1';
  const AI_RUN_ID = 'ai-run-1';
  const TRIGGER_ID = 'trigger-1';
  const TEST_RUN_ID = 'test-run-1';

  function setup(aiRunSetup: 'inbound-reply' | 'first-response' | 'none' = 'inbound-reply') {
    process.env.TWILIO_STATUS_CALLBACK_URL = callbackUrl;
    const lead = Object.assign(new Lead(), {
      id: LEAD_ID,
      tenantId: TENANT_ID,
      testRunId: TEST_RUN_ID,
    });
    const message = Object.assign(new Message(), {
      id: 'message-1',
      leadId: LEAD_ID,
      lead,
      providerMessageId: 'SM123',
      channel: 'sms',
      direction: 'outbound',
      status: 'provider_accepted',
    });
    if (aiRunSetup !== 'none') (message as any).aiRunId = AI_RUN_ID;
    const trigger = Object.assign(new Message(), {
      id: TRIGGER_ID,
      leadId: LEAD_ID,
      channel: 'sms',
      direction: 'inbound',
      body: 'Is this still available?',
    });
    const aiRun =
      aiRunSetup === 'none'
        ? null
        : Object.assign(new AiRun(), {
            id: AI_RUN_ID,
            tenantId: TENANT_ID,
            leadId: LEAD_ID,
            triggerType: aiRunSetup === 'inbound-reply' ? 'inbound' : 'first_response',
            triggeringMessageId:
              aiRunSetup === 'inbound-reply' ? TRIGGER_ID : null,
            promptMetadata: { channel: 'sms' },
          });
    const messages = {
      findOne: jest.fn(async (options: any) => {
        const where = options?.where || {};
        if (where.id === TRIGGER_ID) return trigger;
        return message;
      }),
      save: jest.fn(async (value) => value),
    };
    const aiRuns = { findOne: jest.fn().mockResolvedValue(aiRun) };
    const credentials = {
      findOne: jest.fn().mockResolvedValue({
        encryptedValue: JSON.stringify({ connected: true, authToken }),
        tenant: { id: TENANT_ID },
      }),
    };
    const onboarding = {
      recordAutomatedTestEvidence: jest.fn().mockResolvedValue({}),
    };
    const service = new WebhooksService(
      {} as any,
      credentials as any,
      {} as any,
      {} as any,
      {} as any,
      { acceptInbound: jest.fn() } as any,
      messages as any,
      { createTask: jest.fn() } as any,
      onboarding as any,
      undefined,
      undefined,
      undefined,
      aiRuns as any,
    );
    return { service, message, onboarding };
  }

  function signed(body: Record<string, unknown>) {
    const signature = require('crypto')
      .createHmac('sha1', authToken)
      .update(
        callbackUrl +
          Object.keys(body)
            .sort()
            .map((key) => `${key}${String(body[key] ?? '')}`)
            .join(''),
      )
      .digest('base64');
    return { 'x-twilio-signature': signature };
  }

  it('records inbound SMS reply delivery from the Twilio status path', async () => {
    const { service, onboarding } = setup('inbound-reply');
    const body = { MessageSid: 'SM123', MessageStatus: 'delivered' };
    await service.handleTwilioStatus(body, signed(body));
    expect(onboarding.recordAutomatedTestEvidence).toHaveBeenCalledWith(
      TENANT_ID,
      {
        outboundDelivered: true,
        inboundSmsAiReplyDelivered: true,
        testRunId: TEST_RUN_ID,
      },
    );
  });

  it('does not record SMS reply evidence for a first_response run', async () => {
    const { service, onboarding } = setup('first-response');
    const body = { MessageSid: 'SM123', MessageStatus: 'delivered' };
    await service.handleTwilioStatus(body, signed(body));
    expect(onboarding.recordAutomatedTestEvidence).toHaveBeenCalledWith(
      TENANT_ID,
      {
        outboundDelivered: true,
        testRunId: TEST_RUN_ID,
      },
    );
    expect(onboarding.recordAutomatedTestEvidence).not.toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ inboundSmsAiReplyDelivered: true }),
    );
  });

  it('does not record SMS reply evidence without an AI run', async () => {
    const { service, onboarding } = setup('none');
    const body = { MessageSid: 'SM123', MessageStatus: 'delivered' };
    await service.handleTwilioStatus(body, signed(body));
    expect(onboarding.recordAutomatedTestEvidence).not.toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ inboundSmsAiReplyDelivered: true }),
    );
  });
});
