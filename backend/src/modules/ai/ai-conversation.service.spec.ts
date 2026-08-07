import { ServiceUnavailableException } from '@nestjs/common';
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
    });
    expect(item.dependencies.operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedEntityType: 'ai_run',
        relatedEntityId: item.run.id,
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
});
