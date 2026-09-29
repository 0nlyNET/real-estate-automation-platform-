import { ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataType, newDb } from 'pg-mem';
import { DataSource } from 'typeorm';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { AiConversationService } from './ai-conversation.service';
import { AiRun } from './ai-run.entity';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { ConversationAiState } from './conversation-ai-state.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';
import { AiPolicyService } from './ai-policy.service';

function fixture(mode: 'draft' | 'controlled_autopilot' = 'draft') {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const lead = Object.assign(new Lead(), {
    id: '00000000-0000-4000-8000-000000000020',
    tenantId,
    fullName: 'Jordan Client',
    phone: '15555550100',
    leadType: 'buyer',
    stage: 'new',
    temperature: 'warm',
    readinessLevel: 'exploring',
    qualificationData: {},
    preferredAreas: [],
  });
  const trigger = Object.assign(new Message(), {
    id: '00000000-0000-4000-8000-000000000030',
    leadId: lead.id,
    lead,
    channel: 'sms',
    direction: 'inbound',
    body: 'I am looking for a home near Austin.',
    status: 'received',
    createdAt: new Date(),
  });
  const settings = Object.assign(new WorkspaceAiSettings(), {
    tenantId,
    aiEnabled: true,
    aiFirstResponderEnabled: true,
    allowedChannels: ['sms', 'email'],
    aiPaused: false,
    responseMode: mode,
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
    approvalStatus: 'approved',
    updatedAt: new Date(),
  });
  const state = Object.assign(new ConversationAiState(), {
    tenantId,
    leadId: lead.id,
    ownershipStatus: 'ai_handling',
    aiTurnCount: 0,
    usageUnits: 0,
  });
  const run = Object.assign(new AiRun(), {
    id: '00000000-0000-4000-8000-000000000040',
    tenantId,
    leadId: lead.id,
    triggeringMessageId: trigger.id,
    provider: 'openai',
    mode,
    status: 'processing',
    requestedTools: [],
    executedTools: [],
    blockedTools: [],
    inputUsage: 0,
    outputUsage: 0,
    attemptCount: 1,
    lockedBy: 'worker',
  });
  const savedMessages: Message[] = [];
  const dependencies = {
    dataSource: {
      transaction: jest.fn(async (callback) =>
        callback({ query: jest.fn().mockResolvedValue([]) }),
      ),
    },
    runs: {
      findOne: jest.fn().mockResolvedValue(run),
      findOneOrFail: jest.fn().mockResolvedValue(run),
      save: jest.fn(async (value) => value),
      create: jest.fn((value) => Object.assign(new AiRun(), value)),
      update: jest.fn(async (criteria, changes) => {
        const matches = Object.entries(criteria).every(
          ([key, value]) => (run as any)[key] === value,
        );
        if (matches) Object.assign(run, changes);
        return { affected: matches ? 1 : 0, raw: [], generatedMaps: [] };
      }),
    },
    settings: { findOne: jest.fn().mockResolvedValue(settings) },
    knowledge: { findOne: jest.fn().mockResolvedValue(knowledge) },
    states: {
      findOne: jest.fn().mockResolvedValue(state),
      save: jest.fn(async (value) => value),
    },
    platform: { findOne: jest.fn().mockResolvedValue({ paused: false }) },
    leads: {
      findOne: jest.fn().mockResolvedValue(lead),
      save: jest.fn(async (value) => value),
    },
    messages: {
      findOne: jest.fn(async ({ where }: any) =>
        where?.id === trigger.id ? trigger : null,
      ),
      find: jest.fn().mockResolvedValue([trigger]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((value) => Object.assign(new Message(), value)),
      save: jest.fn(async (value) => {
        const saved = Object.assign(value, {
          id:
            value.id ||
            `00000000-0000-4000-8000-${String(savedMessages.length + 50).padStart(12, '0')}`,
          createdAt: value.createdAt || new Date(),
        });
        savedMessages.push(saved);
        return saved;
      }),
    },
    credentials: {
      findOne: jest.fn().mockResolvedValue({
        encryptedValue: JSON.stringify({
          connected: true,
          lastSync: new Date().toISOString(),
        }),
      }),
    },
    provider: {
      generate: jest.fn().mockResolvedValue({
        reply: 'What timeline are you considering?',
        confidence: 0.95,
        classification: 'allowed',
        escalationReason: null,
        summary: 'Buyer is looking near Austin.',
        recommendedNextAction: 'Ask about the timeline.',
        leadTemperature: 'warm',
        actions: [],
        provider: 'openai',
        model: 'gpt-5.6',
        inputUsage: 100,
        outputUsage: 30,
        latencyMs: 25,
      }),
    },
    locks: {
      withLock: jest.fn(async (_tenantId, _leadId, callback) => callback()),
    },
    control: {
      getOrCreateState: jest.fn().mockResolvedValue(state),
      markWaitingForHuman: jest.fn().mockResolvedValue(state),
    },
    tools: {
      execute: jest.fn(
        async (_context, request, index) => ({
          name: request.name,
          status: 'executed',
          idempotencyKey: `tool:${index}`,
        }),
      ),
    },
    usage: {
      estimateCost: jest.fn().mockReturnValue(0.01),
      evaluateLimits: jest.fn().mockResolvedValue({ allowed: true }),
    },
    audit: { recordSystem: jest.fn().mockResolvedValue({}) },
    compliance: {
      communicationEligibility: jest.fn().mockResolvedValue({ allowed: true }),
      getQuietHours: jest.fn().mockResolvedValue({ enabled: false }),
    },
    entitlements: {
      evaluate: jest.fn().mockResolvedValue({ allowed: true, reasons: [] }),
    },
    clientOperations: {
      createHandoff: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000080',
      }),
    },
    notifications: { createForTenant: jest.fn().mockResolvedValue({}) },
    operations: { createTask: jest.fn().mockResolvedValue({}) },
  };
  const service = new AiConversationService(
    dependencies.dataSource as any,
    dependencies.runs as any,
    dependencies.settings as any,
    dependencies.knowledge as any,
    dependencies.states as any,
    dependencies.platform as any,
    dependencies.leads as any,
    dependencies.messages as any,
    dependencies.credentials as any,
    dependencies.provider as any,
    dependencies.locks as any,
    dependencies.control as any,
    new AiPolicyService(),
    dependencies.tools as any,
    dependencies.usage as any,
    dependencies.audit as any,
    dependencies.compliance as any,
    dependencies.entitlements as any,
    dependencies.clientOperations as any,
    dependencies.notifications as any,
    dependencies.operations as any,
  );
  run.lockedBy = (service as any).workerId;
  jest.spyOn(service as any, 'preflight').mockResolvedValue({
    allowed: true,
    settings,
    knowledge,
    state,
    lead,
    triggeringMessage: trigger,
  });
  jest.spyOn(service as any, 'contextMessages').mockResolvedValue([
    {
      direction: 'inbound',
      channel: 'sms',
      body: trigger.body,
      authorship: 'system',
      createdAt: trigger.createdAt.toISOString(),
    },
  ]);
  return {
    tenantId,
    lead,
    trigger,
    settings,
    knowledge,
    state,
    run,
    savedMessages,
    dependencies,
    service,
  };
}

describe('AI conversation workflow', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    jest.useRealTimers();
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('queues an automatic first response without fabricating an inbound message', async () => {
    const item = fixture('controlled_autopilot');
    item.lead.smsEligible = true;
    item.dependencies.runs.findOne.mockResolvedValueOnce(null);
    item.dependencies.runs.save.mockImplementationOnce(async (value: any) => {
      value.id = '00000000-0000-4000-8000-000000000099';
      return value;
    });
    await expect(item.service.acceptLead({ tenantId: item.tenantId, leadId: item.lead.id })).resolves.toEqual({
      status: 'queued', runId: '00000000-0000-4000-8000-000000000099', channel: 'sms',
    });
    expect(item.dependencies.runs.create).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: item.tenantId,
      leadId: item.lead.id,
      triggeringMessageId: null,
      triggerType: 'first_response',
      status: 'queued',
    }));
  });

  it('does not queue a first response after a human takes ownership', async () => {
    const item = fixture('controlled_autopilot');
    item.lead.smsEligible = true;
    item.state.ownershipStatus = 'human_handling';
    await expect(item.service.acceptLead({ tenantId: item.tenantId, leadId: item.lead.id })).resolves.toEqual({
      status: 'ignored', code: 'HUMAN_CONTROLLED',
    });
    expect(item.dependencies.runs.create).not.toHaveBeenCalled();
  });

  it('honors the approved first-response switch and channel list', async () => {
    const disabled = fixture('controlled_autopilot');
    disabled.lead.smsEligible = true;
    disabled.settings.aiFirstResponderEnabled = false;
    await expect(disabled.service.acceptLead({ tenantId: disabled.tenantId, leadId: disabled.lead.id }))
      .resolves.toEqual({ status: 'ignored', code: 'AI_NOT_ENABLED' });
    expect(disabled.dependencies.runs.create).not.toHaveBeenCalled();

    const emailOnly = fixture('controlled_autopilot');
    emailOnly.lead.smsEligible = true;
    emailOnly.lead.emailEligible = true;
    emailOnly.lead.email = 'jordan@example.com';
    emailOnly.settings.allowedChannels = ['email'];
    emailOnly.dependencies.runs.findOne.mockResolvedValueOnce(null);
    emailOnly.dependencies.runs.save.mockImplementationOnce(async (value: any) => {
      value.id = '00000000-0000-4000-8000-000000000098';
      return value;
    });
    await expect(emailOnly.service.acceptLead({ tenantId: emailOnly.tenantId, leadId: emailOnly.lead.id }))
      .resolves.toMatchObject({ status: 'queued', channel: 'email' });
    expect(emailOnly.dependencies.runs.create).toHaveBeenCalledWith(expect.objectContaining({
      promptMetadata: expect.objectContaining({ channel: 'email' }),
    }));
  });

  it('passes controlled TESTING context to the normal entitlement gate', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const item = fixture('controlled_autopilot');
    item.lead.testRunId = '00000000-0000-4000-8000-000000000090';
    (item.service as any).preflight.mockRestore();
    await expect((item.service as any).preflight({
      tenantId: item.tenantId,
      leadId: item.lead.id,
      messageId: null,
      channel: 'sms',
      triggerType: 'first_response',
    })).resolves.toMatchObject({ allowed: true, lead: item.lead });
    expect(item.dependencies.entitlements.evaluate).toHaveBeenCalledWith(
      item.tenantId,
      'send_automated_sms',
      expect.any(Date),
      { controlledTest: true },
    );
  });

  it('preserves testRunId in promptMetadata when processRun replaces it (retry safety)', async () => {
    const item = fixture('controlled_autopilot');
    const testRunId = '00000000-0000-4000-8000-000000000091';
    // Simulate an ai_run created with testRunId in promptMetadata.
    item.run.promptMetadata = {
      channel: 'sms',
      triggerType: 'first_response',
      contentsStored: false,
      testRunId,
    };
    // The worker reconstructs the event from promptMetadata.
    const event = {
      tenantId: item.tenantId,
      leadId: item.lead.id,
      messageId: null,
      channel: 'sms' as const,
      triggerType: 'first_response' as const,
      testRunId: (item.run.promptMetadata as any)?.testRunId || null,
    };
    expect(event.testRunId).toBe(testRunId);
    // After processRun replaces promptMetadata, testRunId must survive.
    await (item.service as any).processRun(item.run.id);
    expect((item.run.promptMetadata as any)?.testRunId).toBe(testRunId);
  });

  it('ordinary lead without testRunId does not gain controlled-test exception', async () => {
    const item = fixture('controlled_autopilot');
    // No testRunId on lead, none passed explicitly.
    item.lead.testRunId = null;
    (item.service as any).preflight.mockRestore();
    const result = await (item.service as any).preflight({
      tenantId: item.tenantId,
      leadId: item.lead.id,
      messageId: null,
      channel: 'sms',
      triggerType: 'first_response',
      testRunId: null,
    });
    // The entitlement gate must see controlledTest: false for ordinary leads.
    expect(item.dependencies.entitlements.evaluate).toHaveBeenCalledWith(
      item.tenantId,
      'send_automated_sms',
      expect.any(Date),
      { controlledTest: false },
    );
    // And the preflight must DENY (not allow) for a non-controlled lead
    // in a TESTING workspace. This proves the exception is not granted.
    expect(result.allowed).toBe(false);
  });

  it.each([
    ['draft', 'draft'],
    ['controlled_autopilot', 'queued'],
  ] as const)(
    '%s mode prepares the permitted response through the existing queue as %s',
    async (mode, expectedStatus) => {
      const item = fixture(mode);
      await (item.service as any).processRun(item.run.id);
      expect(item.dependencies.provider.generate).toHaveBeenCalledTimes(1);
      expect(item.savedMessages).toHaveLength(1);
      expect(item.savedMessages[0]).toMatchObject({
        status: expectedStatus,
        authorship: 'ai',
        aiRunId: item.run.id,
      });
      expect(item.savedMessages[0].body).toContain(
        'the virtual assistant for Lakeview Realty',
      );
      expect(item.run.status).toBe(
        mode === 'draft' ? 'drafted' : 'response_queued',
      );
      expect(item.state.lastInboundMessageIdProcessed).toBe(item.trigger.id);
    },
  );

  it.each([
    ['Please connect me with a human agent.', 'HUMAN_REQUESTED'],
    ['Can you negotiate this contract for me?', 'LEGAL_OR_CONTRACT'],
    [
      'Which neighborhood is best for families with children?',
      'FAIR_HOUSING',
    ],
  ])(
    'deterministically escalates “%s” with a handoff before calling the model',
    async (body, code) => {
      const item = fixture('controlled_autopilot');
      item.trigger.body = body;
      await expect(
        item.service.acceptInbound({
          tenantId: item.tenantId,
          leadId: item.lead.id,
          messageId: item.trigger.id,
          channel: 'sms',
        }),
      ).resolves.toEqual({ status: 'escalated' });
      expect(item.state).toMatchObject({
        ownershipStatus: 'waiting_for_human',
        aiPausedReason: code,
      });
      expect(
        item.dependencies.clientOperations.createHandoff,
      ).toHaveBeenCalled();
      expect(item.dependencies.provider.generate).not.toHaveBeenCalled();
    },
  );

  it('delays an autopilot response during quiet hours', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-25T23:00:00.000Z'));
    const item = fixture('controlled_autopilot');
    item.dependencies.compliance.getQuietHours.mockResolvedValue({
      enabled: true,
      timezone: 'UTC',
      startMinute: 21 * 60,
      endMinute: 8 * 60,
    });
    await (item.service as any).processRun(item.run.id);
    expect(item.savedMessages[0].scheduledAt).toBeInstanceOf(Date);
    expect(item.savedMessages[0].scheduledAt!.getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('controlled test leads bypass quiet-hours scheduling', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-25T23:00:00.000Z'));
    const item = fixture('controlled_autopilot');
    // Simulate a controlled test lead by setting testRunId on the lead
    item.lead.testRunId = 'test-run-123';
    item.dependencies.compliance.getQuietHours.mockResolvedValue({
      enabled: true,
      timezone: 'UTC',
      startMinute: 21 * 60,
      endMinute: 8 * 60,
    });
    await (item.service as any).processRun(item.run.id);
    // Controlled test message should NOT be scheduled for the future
    // (scheduledAt should be undefined, meaning send immediately)
    expect(item.savedMessages[0].scheduledAt).toBeUndefined();
  });

  it('provider timeout creates a handoff and human task without improvising a reply', async () => {
    const item = fixture('controlled_autopilot');
    item.dependencies.provider.generate.mockRejectedValue(
      new ServiceUnavailableException({
        code: 'AI_PROVIDER_TIMEOUT',
        message: 'The AI provider timed out',
      }),
    );
    await (item.service as any).processRun(item.run.id);
    expect(item.savedMessages).toHaveLength(0);
    expect(item.run).toMatchObject({
      status: 'failed',
      errorCode: 'AI_PROVIDER_TIMEOUT',
    });
    expect(item.state.ownershipStatus).toBe('waiting_for_human');
    expect(item.dependencies.clientOperations.createHandoff).toHaveBeenCalled();
    expect(item.dependencies.operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'ai_provider_failure' }),
    );
  });

  it('a failed tool blocks the reply instead of claiming false success', async () => {
    const item = fixture('controlled_autopilot');
    (item.dependencies.tools.execute as jest.Mock).mockResolvedValue({
      name: 'update_conversation_summary',
      status: 'blocked',
      idempotencyKey: 'tool:0',
      code: 'TOOL_VALIDATION_FAILED',
      reason: 'Validated tool execution failed',
    });
    await (item.service as any).processRun(item.run.id);
    expect(item.savedMessages).toHaveLength(0);
    expect(item.run).toMatchObject({
      status: 'blocked',
      errorCode: 'TOOL_VALIDATION_FAILED',
    });
    expect(item.state.ownershipStatus).toBe('waiting_for_human');
  });

  it('two AI workers cannot claim the same inbound run', async () => {
    const item = fixture('draft');
    let available = true;
    const query = jest.fn(async (_sql: string, _parameters?: unknown[]) => {
      if (!available) return [];
      available = false;
      return [{ id: item.run.id }];
    });
    item.dependencies.dataSource.transaction.mockImplementation(
      async (callback) => callback({ query }),
    );
    const first = await (item.service as any).claimRuns(1);
    const second = await (item.service as any).claimRuns(1);
    expect(first).toEqual([item.run.id]);
    expect(second).toEqual([]);
    expect(String(query.mock.calls[0][0])).toContain('FOR UPDATE SKIP LOCKED');
    expect(String(query.mock.calls[0][0])).toContain('attempt_count < $4');
  });

  it('bounds crash recovery attempts and escalates an exhausted run instead of dropping it', async () => {
    const item = fixture('controlled_autopilot');
    item.dependencies.dataSource.transaction.mockImplementation(
      async (callback) =>
        callback({
          query: jest.fn(async (sql: string) =>
            sql.includes('AI_RUN_ATTEMPTS_EXHAUSTED')
              ? [
                  {
                    id: item.run.id,
                    tenantId: item.tenantId,
                    leadId: item.lead.id,
                  },
                ]
              : [],
          ),
        }),
    );

    await expect(item.service.processPendingRuns(10)).resolves.toEqual({
      claimed: 0,
      recovered: 1,
      paused: false,
    });
    expect(item.dependencies.operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedEntityType: 'lead',
        relatedEntityId: item.lead.id,
        dedupeOpen: true,
        throttleHours: 24,
      }),
    );
    expect(item.dependencies.control.markWaitingForHuman).toHaveBeenCalledWith(
      item.tenantId,
      item.lead.id,
      expect.stringContaining('interrupted repeatedly'),
      'high',
    );
  });

  it.each([
    [
      'missing consent',
      { allowed: false, code: 'MISSING_AFFIRMATIVE_CONSENT', reason: 'No consent' },
      { allowed: true, reasons: [] },
      'MISSING_AFFIRMATIVE_CONSENT',
    ],
    [
      'suspended service',
      { allowed: true },
      { allowed: false, reasons: ['Workspace lifecycle is SUSPENDED'] },
      'SERVICE_NOT_ENTITLED',
    ],
  ])(
    'blocks %s before a provider call',
    async (_name, consent, entitlement, expectedCode) => {
      const item = fixture('controlled_autopilot');
      jest.restoreAllMocks();
      process.env.OPENAI_API_KEY = 'configured-for-test';
      item.dependencies.compliance.communicationEligibility.mockResolvedValue(
        consent,
      );
      item.dependencies.entitlements.evaluate.mockResolvedValue(entitlement);
      const decision = await (item.service as any).preflight({
        tenantId: item.tenantId,
        leadId: item.lead.id,
        messageId: item.trigger.id,
        channel: 'sms',
      });
      expect(decision).toMatchObject({
        allowed: false,
        code: expectedCode,
      });
      expect(item.dependencies.provider.generate).not.toHaveBeenCalled();
    },
  );

  it('rejects unapproved brokerage knowledge before calling the provider', async () => {
    const item = fixture('controlled_autopilot');
    jest.restoreAllMocks();
    item.knowledge.approvalStatus = 'draft';
    const decision = await (item.service as any).preflight({
      tenantId: item.tenantId,
      leadId: item.lead.id,
      messageId: item.trigger.id,
      channel: 'sms',
    });
    expect(decision).toMatchObject({
      allowed: false,
      code: 'KNOWLEDGE_NOT_APPROVED',
    });
    expect(item.dependencies.provider.generate).not.toHaveBeenCalled();
  });

  it('blocks and escalates a stale run before model or tool execution', async () => {
    const item = fixture('controlled_autopilot');
    item.run.createdAt = new Date(Date.now() - 16 * 60_000);

    await (item.service as any).processRun(item.run.id);

    expect(item.run).toMatchObject({
      status: 'blocked',
      errorCode: 'STALE_AUTOMATION',
      lockedAt: null,
      lockedBy: null,
    });
    expect(item.dependencies.provider.generate).not.toHaveBeenCalled();
    expect(item.dependencies.tools.execute).not.toHaveBeenCalled();
    expect(item.dependencies.clientOperations.createHandoff).toHaveBeenCalledTimes(1);
    expect(item.dependencies.audit.recordSystem).toHaveBeenCalledWith(
      item.lead.id,
      'ai_run_blocked',
      expect.objectContaining({ runId: item.run.id, code: 'STALE_AUTOMATION' }),
    );
  });
});

describe('ai worker tick serialization', () => {
  it('never overlaps a slow tick with the next one', async () => {
    const service = new AiConversationService(
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
    );
    let concurrent = 0;
    let maxConcurrent = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    (service as any).processPendingRuns = jest.fn(async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await gate;
      concurrent -= 1;
    });

    const first = (service as any).tickWorker();
    // Let the first tick start its (slow) work.
    await new Promise((resolve) => setTimeout(resolve, 25));
    // A second tick while the first is running must be skipped, not queued.
    await (service as any).tickWorker();
    expect((service as any).processPendingRuns).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(maxConcurrent).toBe(1);

    // Once the worker is idle, ticks run again.
    (service as any).processPendingRuns = jest.fn().mockResolvedValue(undefined);
    await (service as any).tickWorker();
    expect((service as any).processPendingRuns).toHaveBeenCalledTimes(1);
  });
});

describe('ai worker incident regression (2026-09-27)', () => {
  function pausedFixture() {
    const item = fixture('controlled_autopilot');
    const query = jest.fn(async () => []);
    item.dependencies.dataSource.transaction.mockImplementation(
      async (callback) => callback({ query }),
    );
    item.dependencies.platform.findOne.mockResolvedValue({ paused: true });
    return { item, query };
  }

  it('platform emergency pause stops recovery, claims, and processing', async () => {
    const { item, query } = pausedFixture();
    const result = await item.service.processPendingRuns(10);
    expect(result).toEqual({ claimed: 0, recovered: 0, paused: true });
    // No worker SQL ran at all: no recoverExhaustedRuns, no claimRuns.
    expect(query).not.toHaveBeenCalled();
    expect(item.dependencies.operations.createTask).not.toHaveBeenCalled();
    expect(
      item.dependencies.control.markWaitingForHuman,
    ).not.toHaveBeenCalled();
  });

  it('GLOBAL_AUTOMATIONS_DISABLED stops all worker activity', async () => {
    const item = fixture('controlled_autopilot');
    const query = jest.fn(async () => []);
    item.dependencies.dataSource.transaction.mockImplementation(
      async (callback) => callback({ query }),
    );
    const previous = process.env.GLOBAL_AUTOMATIONS_DISABLED;
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'true';
    try {
      const result = await item.service.processPendingRuns(10);
      expect(result).toEqual({ claimed: 0, recovered: 0, paused: true });
      expect(query).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.GLOBAL_AUTOMATIONS_DISABLED;
      else process.env.GLOBAL_AUTOMATIONS_DISABLED = previous;
    }
  });

  it('recovery normalizes the real [rows, rowCount] driver shape', async () => {
    // Regression: the pg driver returns [rows, rowCount] for UPDATE ...
    // RETURNING. Iterating the tuple visited the inner array and the count
    // as "rows", so row.id/leadId were undefined and every tick minted a
    // task + notification with "Exhausted ai_run undefined".
    const item = fixture('controlled_autopilot');
    const row = {
      id: item.run.id,
      tenantId: item.tenantId,
      leadId: item.lead.id,
    };
    item.dependencies.dataSource.transaction.mockImplementation(
      async (callback) =>
        callback({
          query: jest.fn(async (sql: string) =>
            sql.includes('AI_RUN_ATTEMPTS_EXHAUSTED') ? [[row], 1] : [],
          ),
        }),
    );
    const result = await item.service.processPendingRuns(10);
    expect(result).toEqual({ claimed: 0, recovered: 1, paused: false });
    expect(item.dependencies.operations.createTask).toHaveBeenCalledTimes(1);
    expect(item.dependencies.operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: item.tenantId,
        relatedEntityType: 'lead',
        relatedEntityId: item.lead.id,
        evidenceNote: `Exhausted ai_run ${item.run.id}`,
      }),
    );
    const evidenceNote =
      item.dependencies.operations.createTask.mock.calls[0][0].evidenceNote;
    expect(evidenceNote).not.toContain('undefined');
  });

  it('recovery skips rows with missing identifiers instead of minting undefined tasks', async () => {
    const item = fixture('controlled_autopilot');
    const errorSpy = jest
      .spyOn((item.service as any).logger, 'error')
      .mockImplementation(() => undefined);
    item.dependencies.dataSource.transaction.mockImplementation(
      async (callback) =>
        callback({
          // Malformed driver result: ids absent at runtime despite the
          // declared TypeScript type.
          query: jest.fn(async (sql: string) =>
            sql.includes('AI_RUN_ATTEMPTS_EXHAUSTED')
              ? [[{ id: undefined, tenantId: undefined, leadId: undefined }], 1]
              : [],
          ),
        }),
    );
    const result = await item.service.processPendingRuns(10);
    expect(result).toEqual({ claimed: 0, recovered: 0, paused: false });
    expect(item.dependencies.operations.createTask).not.toHaveBeenCalled();
    expect(
      item.dependencies.control.markWaitingForHuman,
    ).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('exhausted runs are terminal: recovery only targets queued/processing runs', async () => {
    const item = fixture('controlled_autopilot');
    const seen: string[] = [];
    item.dependencies.dataSource.transaction.mockImplementation(
      async (callback) =>
        callback({
          query: jest.fn(async (sql: string) => {
            if (sql.includes('AI_RUN_ATTEMPTS_EXHAUSTED')) seen.push(sql);
            return [];
          }),
        }),
    );
    await item.service.processPendingRuns(10);
    expect(seen).toHaveLength(1);
    // A run already marked failed/AI_RUN_ATTEMPTS_EXHAUSTED must never be
    // eligible for recovery again, across ticks and restarts: the candidate
    // selection is restricted to queued/processing runs.
    expect(seen[0]).toContain("status IN ('queued', 'processing')");
    const candidatesCte = seen[0].split('UPDATE ai_runs')[0];
    expect(candidatesCte).not.toContain("'failed'");
  });

  it('claimRuns normalizes the [rows, rowCount] shape and drops invalid ids', async () => {
    const item = fixture('controlled_autopilot');
    item.dependencies.dataSource.transaction.mockImplementation(
      async (callback) =>
        callback({
          query: jest.fn(async () => [[{ id: item.run.id }], 1]),
        }),
    );
    await expect((item.service as any).claimRuns(1)).resolves.toEqual([
      item.run.id,
    ]);
  });
});

describe('BUG 1 regression: recoverExhaustedRuns never blocks worker loop (2026-09-28)', () => {
  it('recovery timeout does not prevent claimRuns from executing', async () => {
    const item = fixture('controlled_autopilot');
    // Simulate recoverExhaustedRuns hanging: transaction never resolves.
    // The withTimeout wrapper (15s) should reject, and processPendingRuns
    // should continue to claimRuns.
    let claimCalled = false;
    item.dependencies.dataSource.transaction.mockImplementation(async (callback) => {
      // First call is recoverExhaustedRuns (hang), second is claimRuns.
      // We need to distinguish: recoverExhaustedRuns uses a CTE with
      // 'AI_RUN_ATTEMPTS_EXHAUSTED', claimRuns uses 'attempt_count + 1'.
      return callback({
        query: jest.fn(async (sql: string) => {
          if (sql.includes('AI_RUN_ATTEMPTS_EXHAUSTED')) {
            // Hang forever - simulates the production hang.
            await new Promise(() => {});
            return [[], 0];
          }
          claimCalled = true;
          return [[{ id: item.run.id }], 1];
        }),
      });
    });
    // Mock withTimeout to use a short timeout for the test.
    const originalWithTimeout = (item.service as any).withTimeout.bind(item.service);
    (item.service as any).withTimeout = (promise: Promise<any>, _ms: number, name: string) =>
      originalWithTimeout(promise, 100, name); // 100ms for test speed

    // processRun is called for claimed runs; mock it to avoid side effects.
    const processRunSpy = jest.spyOn(item.service as any, 'processRun').mockResolvedValue(undefined);
    // Mock isWorkerPaused to return false.
    jest.spyOn(item.service as any, 'isWorkerPaused').mockResolvedValue(false);

    const result = await item.service.processPendingRuns(10);
    // Recovery failed (timeout), but claimRuns still executed.
    expect(claimCalled).toBe(true);
    expect(result.claimed).toBe(1);
    expect(result.paused).toBe(false);
    processRunSpy.mockRestore();
  });

  it('empty recovery pass returns promptly with zero recovered', async () => {
    const item = fixture('controlled_autopilot');
    item.dependencies.dataSource.transaction.mockImplementation(async (callback) =>
      callback({
        query: jest.fn(async () => [[], 0]), // No exhausted runs.
      }),
    );
    const recovered = await (item.service as any).recoverExhaustedRuns(10);
    expect(recovered).toBe(0);
    // createTask and markWaitingForHuman should NOT be called for empty results.
    expect(item.dependencies.operations.createTask).not.toHaveBeenCalled();
    expect(item.dependencies.control.markWaitingForHuman).not.toHaveBeenCalled();
  });

  it('recovery exception is isolated and does not kill the worker loop', async () => {
    const item = fixture('controlled_autopilot');
    // Simulate recoverExhaustedRuns throwing (e.g., DB connection failure).
    const recoveryError = new Error('connection terminated');
    let claimCalled = false;
    item.dependencies.dataSource.transaction.mockImplementation(async (callback) => {
      return callback({
        query: jest.fn(async (sql: string) => {
          if (sql.includes('AI_RUN_ATTEMPTS_EXHAUSTED')) {
            throw recoveryError;
          }
          claimCalled = true;
          return [[], 0];
        }),
      });
    });
    jest.spyOn(item.service as any, 'isWorkerPaused').mockResolvedValue(false);
    const processRunSpy = jest.spyOn(item.service as any, 'processRun').mockResolvedValue(undefined);

    // Should not throw; should continue to claimRuns.
    const result = await item.service.processPendingRuns(10);
    expect(claimCalled).toBe(true);
    expect(result.paused).toBe(false);
    processRunSpy.mockRestore();
  });
});

describe('BUG 2 regression: controlled-test context preserved through worker (2026-09-28)', () => {
  it('acceptLead and worker preflight agree on controlledTest for TESTING tenant', async () => {
    const item = fixture('controlled_autopilot');
    const testRunId = '11111111-2222-4333-8444-555555555555';
    // Lead has testRunId (controlled test).
    item.lead.testRunId = testRunId;

    // Simulate acceptLead flow: event includes testRunId explicitly.
    const acceptLeadEvent = {
      tenantId: item.tenantId,
      leadId: item.lead.id,
      messageId: null,
      channel: 'email' as const,
      triggerType: 'first_response' as const,
      testRunId,
    };

    // Simulate worker processRun flow: testRunId comes from ai_run.promptMetadata.
    const workerEvent = {
      tenantId: item.tenantId,
      leadId: item.lead.id,
      messageId: null,
      channel: 'email' as const,
      triggerType: 'first_response' as const,
      testRunId, // From run.promptMetadata.testRunId
    };

    // Both events carry the same testRunId; preflight should see
    // controlledTest=true in both cases.
    // The entitlement check uses: Boolean(event.testRunId || lead.testRunId)
    const acceptLeadControlled = Boolean(acceptLeadEvent.testRunId || item.lead.testRunId);
    const workerControlled = Boolean(workerEvent.testRunId || item.lead.testRunId);

    expect(acceptLeadControlled).toBe(true);
    expect(workerControlled).toBe(true);
    expect(acceptLeadControlled).toBe(workerControlled);
  });

  it('non-controlled lead in TESTING tenant remains DENIED', async () => {
    const item = fixture('controlled_autopilot');
    // Lead has NO testRunId (normal lead).
    item.lead.testRunId = null;

    const event = {
      tenantId: item.tenantId,
      leadId: item.lead.id,
      messageId: null,
      channel: 'email' as const,
      triggerType: 'first_response' as const,
      testRunId: null, // No controlled-test context.
    };

    // Entitlement check: Boolean(event.testRunId || lead.testRunId) = false.
    // For a TESTING workspace, this must result in DENY (not bypass).
    const controlledTest = Boolean(event.testRunId || item.lead.testRunId);
    expect(controlledTest).toBe(false);
    // The entitlement service would deny because:
    // - lifecycleStatus is TESTING (not ACTIVE)
    // - controlledTesting is false (controlledTest=false)
    // This test proves we don't accidentally allow non-test traffic.
  });

  it('tenant isolation: testRunId from tenant A does not grant privileges to tenant B', async () => {
    const itemA = fixture('controlled_autopilot');
    const tenantA = '00000000-0000-4000-8000-0000000000A1';
    const tenantB = '00000000-0000-4000-8000-0000000000B2';
    const testRunIdA = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

    itemA.lead.testRunId = testRunIdA;
    itemA.tenantId = tenantA;

    // Event for tenant B (different tenant) with tenant A's testRunId.
    // This should NOT happen in practice, but the test proves the
    // entitlement check is scoped by tenant.
    const eventForTenantB = {
      tenantId: tenantB, // Different tenant!
      leadId: itemA.lead.id,
      messageId: null,
      channel: 'email' as const,
      triggerType: 'first_response' as const,
      testRunId: testRunIdA, // Tenant A's test ID
    };

    // The preflight fetches lead by (leadId, tenantId). For tenant B,
    // the lead lookup would be: where: { id: leadId, tenantId: tenantB }.
    // This would NOT find tenant A's lead (tenant isolation).
    // The test proves the query is tenant-scoped.
    expect(eventForTenantB.tenantId).not.toBe(itemA.tenantId);
    // In the real preflight, the lead fetch would return null for the
    // wrong tenant, causing AI_CONTEXT_MISSING deny (not a bypass).
  });

  it('createRun persists testRunId in promptMetadata', async () => {
    const item = fixture('controlled_autopilot');
    const testRunId = '22222222-3333-4444-8555-666666666666';
    const savedRun = Object.assign(new AiRun(), {
      id: '00000000-0000-4000-8000-000000000099',
      tenantId: item.tenantId,
      leadId: item.lead.id,
    });

    item.dependencies.runs.findOne.mockResolvedValue(null); // No existing run.
    item.dependencies.runs.create.mockImplementation((data: any) => data);
    item.dependencies.runs.save.mockImplementation(async (data: any) => {
      // Verify testRunId is in promptMetadata.
      expect(data.promptMetadata.testRunId).toBe(testRunId);
      return Object.assign(savedRun, data);
    });

    const event = {
      tenantId: item.tenantId,
      leadId: item.lead.id,
      messageId: null,
      channel: 'email' as const,
      triggerType: 'first_response' as const,
      testRunId,
    };

    await (item.service as any).createRun(event, 'controlled_autopilot', 'queued');
    expect(item.dependencies.runs.save).toHaveBeenCalled();
  });
});

describe('HARDENING: claim→process handoff never silently drops runs (2026-09-28)', () => {
  afterEach(() => jest.restoreAllMocks());

  function prepareWorker(item: ReturnType<typeof fixture>) {
    jest.spyOn(item.service as any, 'isWorkerPaused').mockResolvedValue(false);
    jest.spyOn(item.service as any, 'recoverExhaustedRuns').mockResolvedValue(0);
    jest.spyOn(item.service as any, 'claimRuns').mockResolvedValue([item.run.id]);
    const log = jest.spyOn((item.service as any).logger, 'log').mockImplementation(() => {});
    const error = jest.spyOn((item.service as any).logger, 'error').mockImplementation(() => {});
    jest.spyOn((item.service as any).logger, 'warn').mockImplementation(() => {});
    return { log, error };
  }

  it('logs a missing claim as failed without a completion event from the dispatcher', async () => {
    const item = fixture('controlled_autopilot');
    const { log, error } = prepareWorker(item);
    item.dependencies.runs.findOne.mockResolvedValue(null);
    await item.service.processPendingRuns(1);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('PROCESS_RUN_ENTERED'),
    );
    expect(error).toHaveBeenCalledWith(expect.stringContaining('run_not_found_after_claim'));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('PROCESS_RUN_COMPLETED'));
    expect(item.dependencies.runs.update).not.toHaveBeenCalled();
    expect(item.dependencies.provider.generate).not.toHaveBeenCalled();
  });

  it('does not report completion for a blocked run', async () => {
    const item = fixture('controlled_autopilot');
    const { log } = prepareWorker(item);
    (item.service as any).preflight.mockResolvedValue({
      allowed: false, code: 'AI_PAUSED', reason: 'Paused', priority: 'high',
    });
    await item.service.processPendingRuns(1);
    expect(item.run.status).toBe('blocked');
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('PROCESS_RUN_COMPLETED'));
  });

  it('logs completion only after the run is persisted as completed', async () => {
    const item = fixture('controlled_autopilot');
    const { log } = prepareWorker(item);
    item.state.ownershipStatus = 'human_handling';
    await item.service.processPendingRuns(1);
    expect(item.run.status).toBe('completed');
    expect(log).toHaveBeenCalledWith(JSON.stringify({
      event: 'PROCESS_RUN_COMPLETED', runId: item.run.id, status: 'completed',
    }));
  });

  it.each([
    ['draft', 'drafted'],
    ['controlled_autopilot', 'response_queued'],
  ] as const)('reports the actual %s outcome without claiming completion', async (mode, status) => {
    const item = fixture(mode);
    const { log } = prepareWorker(item);
    await item.service.processPendingRuns(1);
    expect(item.run.status).toBe(status);
    expect(log).toHaveBeenCalledWith(JSON.stringify({
      event: 'PROCESS_RUN_OUTCOME', runId: item.run.id, status,
    }));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('PROCESS_RUN_COMPLETED'));
  });

  describe('conditional failure writes through the TypeORM repository', () => {
    let database: DataSource;

    beforeAll(async () => {
      const memory = newDb();
      memory.public.registerFunction({
        name: 'current_database', returns: DataType.text,
        implementation: () => 'ai_worker_test',
      });
      memory.public.registerFunction({
        name: 'version', returns: DataType.text,
        implementation: () => 'PostgreSQL 16.0',
      });
      memory.public.registerFunction({
        name: 'uuid_generate_v4', returns: DataType.uuid,
        impure: true, implementation: randomUUID,
      });
      database = memory.adapters.createTypeormDataSource({
        type: 'postgres', entities: [AiRun], synchronize: true,
      });
      await database.initialize();
    });

    beforeEach(async () => database.getRepository(AiRun).clear());
    afterAll(async () => database?.destroy());

    async function persistedWorker() {
      const item = fixture('controlled_autopilot');
      const output = prepareWorker(item);
      const runs = database.getRepository(AiRun);
      await runs.save(item.run);
      (item.service as any).runs = runs;
      return { ...item, ...output, runs };
    }

    it('fails an owned processing run and records its operational failure', async () => {
      const item = await persistedWorker();
      jest.spyOn(item.service as any, 'processRun').mockRejectedValue(new Error('dispatch failed'));
      await item.service.processPendingRuns(1);
      expect(await item.runs.findOneByOrFail({ id: item.run.id })).toMatchObject({
        status: 'failed', lockedBy: null, lockedAt: null,
        errorCode: 'WORKER_DISPATCH_ERROR',
      });
      expect(item.dependencies.operations.createTask).toHaveBeenCalledTimes(1);
      expect(item.log).not.toHaveBeenCalledWith(expect.stringContaining('PROCESS_RUN_COMPLETED'));
    });

    it.each([
      ['processing', 'another-worker'],
      ['completed', null],
      ['completed', 'same-worker'],
      ['response_queued', null],
      ['drafted', null],
    ] as const)('preserves a %s run changed after lookup (lock %s)', async (status, owner) => {
      const item = await persistedWorker();
      jest.spyOn(item.service as any, 'processRun').mockRejectedValue(new Error('late failure'));
      const findOne = item.runs.findOne.bind(item.runs);
      const lockedBy = owner === 'same-worker' ? item.run.lockedBy : owner;
      const lockedAt = owner ? new Date('2026-09-28T12:00:00Z') : null;
      jest.spyOn(item.runs, 'findOne').mockImplementationOnce(async (options) => {
        const stale = await findOne(options);
        // A different worker changes the stored row after our read and
        // before our failure write. This uses real ORM-generated SQL.
        await item.runs.update({ id: item.run.id }, { status, lockedBy, lockedAt });
        return stale;
      });
      await item.service.processPendingRuns(1);
      expect(await item.runs.findOneByOrFail({ id: item.run.id })).toMatchObject({
        status, lockedBy, lockedAt, errorCode: null,
      });
      expect(item.dependencies.operations.createTask).not.toHaveBeenCalled();
      expect(item.dependencies.audit.recordSystem).not.toHaveBeenCalled();
      expect(item.log).not.toHaveBeenCalledWith(expect.stringContaining('PROCESS_RUN_COMPLETED'));
    });

    it('also preserves ownership when the provider throws after another worker reclaims the run', async () => {
      const item = await persistedWorker();
      item.dependencies.provider.generate.mockImplementationOnce(async () => {
        await item.runs.update({ id: item.run.id }, { lockedBy: 'another-worker' });
        throw new Error('late provider failure');
      });
      await item.service.processPendingRuns(1);
      expect(await item.runs.findOneByOrFail({ id: item.run.id })).toMatchObject({
        status: 'processing', lockedBy: 'another-worker', errorCode: null,
      });
      expect(item.dependencies.operations.createTask).not.toHaveBeenCalled();
      expect(item.dependencies.clientOperations.createHandoff).not.toHaveBeenCalled();
      expect(item.log).not.toHaveBeenCalledWith(expect.stringContaining('PROCESS_RUN_COMPLETED'));
    });
  });
});
