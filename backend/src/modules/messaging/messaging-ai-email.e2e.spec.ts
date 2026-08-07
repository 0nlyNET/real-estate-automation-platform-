import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { DataSource } from 'typeorm';
import { AiConversationService } from '../ai/ai-conversation.service';
import { AiPolicyService } from '../ai/ai-policy.service';
import { AiRun } from '../ai/ai-run.entity';
import { BrokerageKnowledge } from '../ai/brokerage-knowledge.entity';
import { ConversationAiState } from '../ai/conversation-ai-state.entity';
import { WorkspaceAiSettings } from '../ai/workspace-ai-settings.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from './message.entity';
import { MessagingService } from './messaging.service';
import { SendGridWebhookEvent } from '../webhooks/sendgrid-webhook-event.entity';
import { WebhooksController } from '../webhooks/webhooks.controller';
import { WebhooksService } from '../webhooks/webhooks.service';

describe('email reply to AI response end-to-end', () => {
  const original = { ...process.env };
  let app: INestApplication;

  afterEach(async () => {
    if (app) await app.close();
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  it('proves outbound → authenticated reply → tenant conversation → AI → delivery status', async () => {
    process.env.SENDGRID_INBOUND_USERNAME = 'e2e-sendgrid';
    process.env.SENDGRID_INBOUND_PASSWORD = 'e2e-password';
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.OPENAI_API_KEY = 'configured-mock-key';

    const tenantId = '00000000-0000-4000-8000-000000000001';
    const leadId = '00000000-0000-4000-8000-000000000020';
    let nextMessage = 30;
    let nextRun = 70;
    let nextEvent = 90;
    const uuid = (suffix: number) =>
      `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

    const lead = Object.assign(new Lead(), {
      id: leadId,
      tenantId,
      fullName: 'Jordan Client',
      email: 'jordan@example.com',
      emailEligible: true,
      smsEligible: false,
      communicationStatus: 'active',
      sequenceStatus: 'active',
      stage: 'contacted',
      leadType: 'buyer',
      temperature: 'warm',
      readinessLevel: 'exploring',
      qualificationData: {},
      preferredAreas: [],
    });
    const initial = Object.assign(new Message(), {
      id: uuid(nextMessage++),
      lead,
      leadId,
      channel: 'email',
      direction: 'outbound',
      body: 'Are you still interested in Austin homes?\n\nUnsubscribe: {{unsubscribeUrl}}',
      subject: 'Austin home search',
      status: 'queued',
      authorship: 'template',
      attemptCount: 0,
      communicationType: 'email',
      idempotencyKey: 'initial-outbound',
      createdAt: new Date('2026-08-07T12:00:00.000Z'),
      updatedAt: new Date('2026-08-07T12:00:00.000Z'),
    });
    const messages: Message[] = [initial];
    const runs: AiRun[] = [];
    const sendGridEvents: SendGridWebhookEvent[] = [];

    const messageRepo = {
      create: jest.fn((value) => Object.assign(new Message(), value)),
      save: jest.fn(async (value: Message) => {
        if (!value.id) value.id = uuid(nextMessage++);
        value.createdAt ||= new Date();
        value.updatedAt = new Date();
        const index = messages.findIndex((row) => row.id === value.id);
        if (index >= 0) messages[index] = value;
        else messages.push(value);
        return value;
      }),
      findOne: jest.fn(async ({ where }: any) => {
        if (where?.id) {
          const found = messages.find((row) => row.id === where.id) || null;
          if (found) found.lead = lead;
          return found;
        }
        if (where?.idempotencyKey) {
          return messages.find((row) => row.idempotencyKey === where.idempotencyKey) || null;
        }
        if (where?.providerMessageId) {
          return messages.find((row) => row.providerMessageId === where.providerMessageId) || null;
        }
        if (where?.leadId && where?.direction) {
          return [...messages]
            .reverse()
            .find(
              (row) =>
                row.leadId === where.leadId &&
                row.direction === where.direction &&
                (!where.channel || row.channel === where.channel),
            ) || null;
        }
        return null;
      }),
      find: jest.fn(async ({ where, order, take }: any) => {
        let rows = messages.filter((row) => !where?.leadId || row.leadId === where.leadId);
        if (where?.authorship) rows = rows.filter((row) => row.authorship === where.authorship);
        if (where?.status) rows = rows.filter((row) => row.status === where.status);
        rows = [...rows].sort((a, b) =>
          order?.createdAt === 'DESC'
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : a.createdAt.getTime() - b.createdAt.getTime(),
        );
        return take ? rows.slice(0, take) : rows;
      }),
      count: jest.fn(async ({ where }: any) =>
        messages.filter(
          (row) =>
            (!where?.leadId || row.leadId === where.leadId) &&
            (!where?.direction || row.direction === where.direction) &&
            (!where?.authorship || row.authorship === where.authorship),
        ).length,
      ),
      createQueryBuilder: jest.fn(),
    };
    const leadRepo = {
      create: jest.fn((value) => Object.assign(new Lead(), value)),
      save: jest.fn(async (value) => value),
      findOne: jest.fn(async ({ where }: any) => {
        if (where?.id && where.id !== lead.id) return null;
        if (where?.tenantId && where.tenantId !== tenantId) return null;
        if (where?.email && where.email !== lead.email) return null;
        return lead;
      }),
    };
    const leadEventRepo = {
      create: jest.fn((value) => Object.assign(new LeadEvent(), value)),
      save: jest.fn(async (value) => value),
    };
    const eventRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        sendGridEvents.find(
          (row) => row.providerEventId === where.providerEventId,
        ) || null,
      ),
      create: jest.fn((value) => Object.assign(new SendGridWebhookEvent(), value)),
      save: jest.fn(async (value: SendGridWebhookEvent) => {
        value.id ||= uuid(nextEvent++);
        value.createdAt ||= new Date();
        value.updatedAt = new Date();
        sendGridEvents.push(value);
        return value;
      }),
    };
    const runRepo = {
      create: jest.fn((value) => Object.assign(new AiRun(), value)),
      save: jest.fn(async (value: AiRun) => {
        value.id ||= uuid(nextRun++);
        value.createdAt ||= new Date();
        value.updatedAt = new Date();
        const index = runs.findIndex((row) => row.id === value.id);
        if (index >= 0) runs[index] = value;
        else runs.push(value);
        return value;
      }),
      findOne: jest.fn(async ({ where }: any) => {
        if (where?.id) return runs.find((row) => row.id === where.id) || null;
        if (where?.triggeringMessageId) {
          return runs.find(
            (row) => row.triggeringMessageId === where.triggeringMessageId,
          ) || null;
        }
        return null;
      }),
    };
    const settings = Object.assign(new WorkspaceAiSettings(), {
      tenantId,
      aiEnabled: true,
      aiPaused: false,
      responseMode: 'controlled_autopilot',
      identityLabel: 'the virtual assistant for Lakeview Realty',
      maximumAutomaticTurns: 6,
      minimumConfidenceThreshold: 0.82,
      configurationApprovalStatus: 'approved',
      perConversationUsageLimit: 12_000,
      monthlyWorkspaceUsageLimit: 500_000,
    });
    const knowledge = Object.assign(new BrokerageKnowledge(), {
      tenantId,
      publicName: 'Lakeview Realty',
      serviceAreas: ['Austin'],
      businessHours: {},
      approvedFaqs: [],
      prohibitedTopics: [],
      agentRoster: [],
      routingRules: {},
      requiredDisclaimer: null,
      approvalStatus: 'approved',
      updatedAt: new Date(),
    });
    const state = Object.assign(new ConversationAiState(), {
      tenantId,
      leadId,
      ownershipStatus: 'ai_handling',
      aiTurnCount: 0,
      usageUnits: 0,
    });
    const sendgridCredential = {
      provider: 'sendgrid',
      routingKey: 'replies@reply.lakeview.example',
      tenant: { id: tenantId },
      encryptedValue: JSON.stringify({
        configured: true,
        connected: true,
        error: null,
        apiKey: 'mock-sendgrid-key',
        fromEmail: 'agent@lakeview.example',
        fromName: 'Lakeview Realty',
        inboundAddress: 'replies@reply.lakeview.example',
      }),
    };
    const credentials = {
      find: jest.fn().mockResolvedValue([sendgridCredential]),
      findOne: jest.fn(async ({ where }: any) =>
        where?.provider === 'sendgrid' &&
        (!where?.routingKey ||
          where.routingKey === sendgridCredential.routingKey)
          ? sendgridCredential
          : null,
      ),
      save: jest.fn(async (value) => value),
    };

    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('AI_RUN_ATTEMPTS_EXHAUSTED')) return [];
        if (sql.includes('UPDATE ai_runs AS run')) {
          const run = runs.find((row) => row.status === 'queued');
          if (!run) return [];
          run.status = 'processing';
          run.attemptCount = (run.attemptCount || 0) + 1;
          return [{ id: run.id }];
        }
        if (
          sql.includes("AND status = 'sending'") &&
          sql.includes('provider_submission_started_at IS NOT NULL')
        ) {
          return [];
        }
        if (sql.includes('UPDATE messages AS message')) {
          const message = messages.find(
            (row) => row.direction === 'outbound' && row.status === 'queued',
          );
          if (!message) return [];
          message.status = 'sending';
          return [{ id: message.id }];
        }
        return [];
      }),
      getRepository: jest.fn((entity) => {
        if (entity === Message) return messageRepo;
        if (entity === Lead) return leadRepo;
        if (entity === LeadEvent) return leadEventRepo;
        if (entity === SendGridWebhookEvent) return eventRepo;
        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
      createQueryRunner: jest.fn(() => ({
        connect: jest.fn().mockResolvedValue(undefined),
        query: jest.fn().mockResolvedValue([]),
        release: jest.fn().mockResolvedValue(undefined),
      })),
    } as unknown as DataSource;
    const compliance = {
      isStopKeyword: jest.fn().mockReturnValue(false),
      addOptOut: jest.fn().mockResolvedValue({}),
      communicationEligibility: jest.fn().mockResolvedValue({ allowed: true }),
      getQuietHours: jest.fn().mockResolvedValue({ enabled: false }),
      createUnsubscribeToken: jest.fn().mockReturnValue('unsubscribe-token'),
    };
    const sequences = {
      stopForLead: jest.fn(async (_tenant, _lead, reason) => {
        lead.sequenceStatus = 'stopped';
        return reason;
      }),
    };
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
    const aiControl = {
      getOrCreateState: jest.fn().mockResolvedValue(state),
      runAiSendExclusive: jest.fn(async (_tenant, _lead, _message, callback) => ({
        allowed: true,
        result: await callback(),
      })),
      markWaitingForHuman: jest.fn().mockResolvedValue(state),
    };
    const aiProvider = {
      generate: jest.fn().mockResolvedValue({
        reply: 'What price range and move-in timeline are you considering?',
        confidence: 0.96,
        classification: 'allowed',
        escalationReason: null,
        summary: '',
        recommendedNextAction: '',
        leadTemperature: 'unchanged',
        actions: [],
        provider: 'mock-openai',
        model: 'mock-model',
        inputUsage: 100,
        outputUsage: 30,
        latencyMs: 5,
      }),
    };
    const ai = new AiConversationService(
      dataSource,
      runRepo as any,
      { findOne: jest.fn().mockResolvedValue(settings), save: jest.fn() } as any,
      { findOne: jest.fn().mockResolvedValue(knowledge) } as any,
      { findOne: jest.fn().mockResolvedValue(state), save: jest.fn(async (value) => value) } as any,
      { findOne: jest.fn().mockResolvedValue({ paused: false }) } as any,
      leadRepo as any,
      messageRepo as any,
      credentials as any,
      aiProvider as any,
      { withLock: jest.fn(async (_tenant, _lead, callback) => callback()) } as any,
      aiControl as any,
      new AiPolicyService(),
      { execute: jest.fn() } as any,
      {
        estimateCost: jest.fn().mockReturnValue(0.01),
        evaluateLimits: jest.fn().mockResolvedValue({ allowed: true }),
      } as any,
      { recordSystem: jest.fn().mockResolvedValue({}) } as any,
      compliance as any,
      { evaluate: jest.fn().mockResolvedValue({ allowed: true, reasons: [] }) } as any,
      { createHandoff: jest.fn() } as any,
      { createForTenant: jest.fn().mockResolvedValue({}) } as any,
      operations as any,
    );
    const onboarding = {
      recordAutomatedTestEvidence: jest.fn().mockResolvedValue({}),
    };
    const webhooks = new WebhooksService(
      dataSource,
      credentials as any,
      compliance as any,
      sequences as any,
      { intake: jest.fn() } as any,
      ai,
      messageRepo as any,
      operations as any,
      onboarding as any,
    );
    const messaging = new MessagingService(
      dataSource,
      messageRepo as any,
      leadRepo as any,
      { findOne: jest.fn() } as any,
      leadEventRepo as any,
      credentials as any,
      sequences as any,
      compliance as any,
      { evaluateMessageSafety: jest.fn().mockResolvedValue({ allowed: true }) } as any,
      operations as any,
      aiControl as any,
    );
    const sendGridRequests: any[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      sendGridRequests.push(JSON.parse(String(init?.body)));
      const messageId = sendGridRequests.length === 1 ? 'initial-request' : 'ai-request';
      return {
        ok: true,
        status: 202,
        headers: new Headers({ 'x-message-id': messageId }),
      } as Response;
    });

    await messaging.processPendingOutbound({ limit: 10 });
    expect(initial).toMatchObject({
      status: 'provider_accepted',
      providerMessageId: 'sendgrid:initial-request',
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [{ provide: WebhooksService, useValue: webhooks }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const token = await request(app.getHttpServer())
      .post('/webhooks/sendgrid/oauth/token')
      .type('form')
      .send({
        grant_type: 'client_credentials',
        client_id: 'e2e-sendgrid',
        client_secret: 'e2e-password',
      })
      .expect(200);
    await request(app.getHttpServer())
      .post('/webhooks/sendgrid/inbound')
      .set('Authorization', `Bearer ${token.body.access_token}`)
      .field('from', 'Jordan Client <jordan@example.com>')
      .field('envelope', JSON.stringify({ to: ['replies@reply.lakeview.example'] }))
      .field('subject', 'Re: Austin home search')
      .field('text', 'Yes, I am interested. What should I consider next?')
      .field('headers', 'Message-ID: <lead-reply@example.com>\r\n')
      .expect(201)
      .expect({ status: 'ok' });

    const inbound = messages.find(
      (row) => row.direction === 'inbound' && row.channel === 'email',
    )!;
    expect(inbound).toMatchObject({
      leadId,
      subject: 'Re: Austin home search',
      providerMessageId: 'sendgrid:lead-reply@example.com',
      status: 'received',
    });
    expect(lead.sequenceStatus).toBe('stopped');
    expect(sequences.stopForLead).toHaveBeenCalledWith(tenantId, leadId, 'reply');
    expect(onboarding.recordAutomatedTestEvidence).toHaveBeenCalledWith(
      tenantId,
      { inboundEmail: true },
    );
    expect(runs).toEqual([
      expect.objectContaining({
        triggeringMessageId: inbound.id,
        status: 'queued',
      }),
    ]);

    await ai.processPendingRuns(10);
    const aiMessage = messages.find(
      (row) => row.direction === 'outbound' && row.authorship === 'ai',
    )!;
    expect(aiProvider.generate).toHaveBeenCalledTimes(1);
    expect(aiMessage).toMatchObject({
      leadId,
      status: 'queued',
      subject: 'Re: Austin home search',
      inReplyToProviderMessageId: inbound.providerMessageId,
    });
    expect(aiMessage.body).toContain('virtual assistant for Lakeview Realty');

    await messaging.processPendingOutbound({ limit: 10 });
    expect(aiMessage).toMatchObject({
      status: 'provider_accepted',
      providerMessageId: 'sendgrid:ai-request',
    });
    expect(sendGridRequests[1]).toMatchObject({
      from: { email: 'agent@lakeview.example', name: 'Lakeview Realty' },
      reply_to: { email: 'replies@reply.lakeview.example' },
      subject: 'Re: Austin home search',
      personalizations: [
        {
          custom_args: { rta_message_id: aiMessage.id },
          headers: {
            'In-Reply-To': '<lead-reply@example.com>',
          },
        },
      ],
    });

    await request(app.getHttpServer())
      .post('/webhooks/sendgrid/events')
      .set('Authorization', `Bearer ${token.body.access_token}`)
      .send([
        {
          event: 'delivered',
          sg_event_id: 'delivery-event-1',
          sg_message_id: 'ai-request.filter-1',
          rta_message_id: aiMessage.id,
          timestamp: 1_786_060_900,
        },
      ])
      .expect(200)
      .expect({ status: 'ok', processed: 1, duplicates: 0, ignored: 0 });
    expect(aiMessage).toMatchObject({
      status: 'delivered',
      providerStatus: 'delivered',
    });
    expect(aiMessage.deliveredAt).toBeInstanceOf(Date);

    await expect(
      messaging.getThreadMessages(tenantId, leadId, {
        userId: '00000000-0000-4000-8000-000000000010',
        role: 'agent',
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: inbound.id, direction: 'inbound' }),
        expect.objectContaining({
          id: aiMessage.id,
          direction: 'outbound',
          status: 'delivered',
        }),
      ]),
    );
  });
});
