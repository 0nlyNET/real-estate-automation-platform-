import { ConflictException, NotFoundException } from '@nestjs/common';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { AiConversationControlService } from './ai-conversation-control.service';
import { ConversationAiState } from './conversation-ai-state.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { PlatformAiControl } from './platform-ai-control.entity';
import { AiRun } from './ai-run.entity';

function updateQuery() {
  const query: any = {
    update: jest.fn(() => query),
    set: jest.fn(() => query),
    where: jest.fn(() => query),
    andWhere: jest.fn(() => query),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  return query;
}

function build() {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const userId = '00000000-0000-4000-8000-000000000010';
  const lead = Object.assign(new Lead(), {
    id: '00000000-0000-4000-8000-000000000020',
    tenantId,
    fullName: 'Jordan Client',
    phone: '15555550100',
    assignedToUserId: userId,
    qualificationData: {},
  });
  const state = Object.assign(new ConversationAiState(), {
    id: '00000000-0000-4000-8000-000000000030',
    tenantId,
    leadId: lead.id,
    ownershipStatus: 'ai_handling',
    aiTurnCount: 3,
    usageUnits: 10,
    version: 1,
  });
  const settings = Object.assign(new WorkspaceAiSettings(), {
    tenantId,
    aiEnabled: true,
    aiPaused: false,
    responseMode: 'draft',
    identityLabel: 'Lakeview virtual assistant',
    configurationApprovalStatus: 'approved',
  });
  const knowledge = Object.assign(new BrokerageKnowledge(), {
    tenantId,
    approvalStatus: 'approved',
  });
  const platform = Object.assign(new PlatformAiControl(), {
    id: 'global',
    paused: false,
  });
  const pendingQuery = updateQuery();
  const repositories = {
    states: {
      findOne: jest.fn().mockResolvedValue(state),
      save: jest.fn(async (value) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    },
    settings: {
      findOne: jest.fn().mockResolvedValue(settings),
      save: jest.fn(async (value) => value),
    },
    knowledge: { findOne: jest.fn().mockResolvedValue(knowledge) },
    platform: {
      findOne: jest.fn().mockResolvedValue(platform),
      save: jest.fn(async (value) => value),
    },
    runs: {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    },
    messages: {
      createQueryBuilder: jest.fn(() => pendingQuery),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new Message(), {
          id: '00000000-0000-4000-8000-000000000040',
          leadId: lead.id,
          channel: 'sms',
          direction: 'inbound',
          createdAt: new Date(),
        }),
      ),
      save: jest.fn(async (value) => value),
    },
    leads: {
      findOne: jest.fn().mockImplementation(async ({ where }: any) =>
        where.id === lead.id && where.tenantId === tenantId ? lead : null,
      ),
      save: jest.fn(async (value) => value),
    },
    handoffs: { findOne: jest.fn().mockResolvedValue(null) },
    tenants: { find: jest.fn().mockResolvedValue([]) },
  };
  const dependencies = {
    locks: {
      withLock: jest.fn(async (_tenantId, _leadId, callback) => callback()),
    },
    compliance: {
      communicationEligibility: jest.fn().mockResolvedValue({ allowed: true }),
    },
    entitlements: {
      evaluate: jest.fn().mockResolvedValue({ allowed: true, reasons: [] }),
    },
    sequences: { stopForLead: jest.fn().mockResolvedValue(undefined) },
    operations: {
      createHandoff: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000050',
      }),
    },
    notifications: { createForTenant: jest.fn().mockResolvedValue({}) },
    aiAudit: { recordHuman: jest.fn().mockResolvedValue({}) },
    audit: { record: jest.fn().mockResolvedValue({}) },
  };
  const service = new AiConversationControlService(
    repositories.states as any,
    repositories.settings as any,
    repositories.knowledge as any,
    repositories.platform as any,
    repositories.runs as any,
    repositories.messages as any,
    repositories.leads as any,
    repositories.handoffs as any,
    repositories.tenants as any,
    dependencies.locks as any,
    dependencies.compliance as any,
    dependencies.entitlements as any,
    dependencies.sequences as any,
    dependencies.operations as any,
    dependencies.notifications as any,
    dependencies.aiAudit as any,
    dependencies.audit as any,
  );
  return {
    tenantId,
    userId,
    lead,
    state,
    settings,
    platform,
    repositories,
    dependencies,
    pendingQuery,
    service,
  };
}

describe('AI conversation ownership', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('Take Over cancels pending AI replies, stops follow-up, and records human control', async () => {
    const fixture = build();
    const result = await fixture.service.takeOver(
      fixture.tenantId,
      fixture.lead.id,
      {
        userId: fixture.userId,
        email: 'agent@example.com',
        role: 'agent',
      },
    );
    expect(fixture.pendingQuery.execute).toHaveBeenCalled();
    expect(fixture.dependencies.sequences.stopForLead).toHaveBeenCalledWith(
      fixture.tenantId,
      fixture.lead.id,
      'manual',
    );
    expect(fixture.state.ownershipStatus).toBe('human_handling');
    expect(fixture.state.takenOverByUserId).toBe(fixture.userId);
    expect(fixture.dependencies.operations.createHandoff).toHaveBeenCalled();
    expect(fixture.dependencies.aiAudit.recordHuman).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai_conversation_takeover' }),
    );
    expect(result.ownershipStatus).toBe('human_handling');
  });

  it('a manual reply atomically switches ownership to human before sending', async () => {
    const fixture = build();
    const send = jest.fn().mockResolvedValue({ status: 'sent' });
    await expect(
      fixture.service.runHumanSendExclusive(
        fixture.tenantId,
        fixture.lead.id,
        {
          userId: fixture.userId,
          email: 'agent@example.com',
          role: 'agent',
        },
        send,
      ),
    ).resolves.toEqual({ status: 'sent' });
    expect(fixture.state.ownershipStatus).toBe('human_handling');
    expect(fixture.pendingQuery.execute).toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('Return to AI requires confirmation and resets the consecutive turn count', async () => {
    const fixture = build();
    fixture.state.ownershipStatus = 'human_handling';
    process.env.OPENAI_API_KEY = 'configured-for-test';
    const actor = {
      userId: fixture.userId,
      email: 'agent@example.com',
      role: 'agent' as const,
    };
    await expect(
      fixture.service.returnToAi(
        fixture.tenantId,
        fixture.lead.id,
        actor,
        false,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      fixture.service.returnToAi(
        fixture.tenantId,
        fixture.lead.id,
        actor,
        true,
      ),
    ).resolves.toMatchObject({ ownershipStatus: 'ai_handling' });
    expect(fixture.state.aiTurnCount).toBe(0);
    expect(fixture.dependencies.aiAudit.recordHuman).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai_conversation_returned' }),
    );
  });

  it('rejects cross-tenant conversation access without querying drafts', async () => {
    const fixture = build();
    await expect(
      fixture.service.getConversation(
        '00000000-0000-4000-8000-000000000099',
        fixture.lead.id,
        { userId: fixture.userId, role: 'owner' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fixture.repositories.messages.find).not.toHaveBeenCalled();
  });

  it('exposes the latest durable AI processing state for the conversation UI', async () => {
    const fixture = build();
    fixture.repositories.runs.findOne.mockResolvedValue(
      Object.assign(new AiRun(), {
        id: '00000000-0000-4000-8000-000000000060',
        tenantId: fixture.tenantId,
        leadId: fixture.lead.id,
        triggeringMessageId: '00000000-0000-4000-8000-000000000040',
        status: 'processing',
        updatedAt: new Date('2026-08-07T12:00:00.000Z'),
      }),
    );
    await expect(
      fixture.service.getConversation(fixture.tenantId, fixture.lead.id, {
        userId: fixture.userId,
        role: 'agent',
      }),
    ).resolves.toMatchObject({
      latestAiRun: {
        status: 'processing',
        triggeringMessageId: '00000000-0000-4000-8000-000000000040',
      },
    });
  });

  it('does not allow an AI send after a conversation becomes human-controlled', async () => {
    const fixture = build();
    fixture.state.ownershipStatus = 'human_handling';
    const providerSend = jest.fn();
    await expect(
      fixture.service.runAiSendExclusive(
        fixture.tenantId,
        fixture.lead.id,
        '00000000-0000-4000-8000-000000000040',
        providerSend,
      ),
    ).resolves.toMatchObject({ allowed: false });
    expect(providerSend).not.toHaveBeenCalled();
  });

  it('platform emergency pause cancels queued AI work without disabling the platform', async () => {
    const fixture = build();
    await fixture.service.setPlatformPause(
      true,
      'Controlled emergency test',
      {
        id: fixture.userId,
        email: 'owner@example.com',
      },
    );
    expect(fixture.platform.paused).toBe(true);
    expect(fixture.pendingQuery.execute).toHaveBeenCalled();
    expect(fixture.repositories.runs.update).toHaveBeenCalledWith(
      { status: 'queued' },
      expect.objectContaining({ status: 'blocked' }),
    );
    expect(fixture.repositories.states.update).toHaveBeenCalledWith(
      { ownershipStatus: 'ai_handling' },
      expect.objectContaining({ ownershipStatus: 'paused' }),
    );
  });
});
