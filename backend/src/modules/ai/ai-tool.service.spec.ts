import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { AiRun } from './ai-run.entity';
import { AiToolService } from './ai-tool.service';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { ConversationAiState } from './conversation-ai-state.entity';
import { PlatformAiControl } from './platform-ai-control.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';

function fixture() {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const lead = Object.assign(new Lead(), {
    id: '00000000-0000-4000-8000-000000000010',
    tenantId,
    fullName: 'Jordan Lead',
    leadType: 'buyer',
    qualificationData: {},
  });
  const trigger = Object.assign(new Message(), {
    id: '00000000-0000-4000-8000-000000000020',
    leadId: lead.id,
    channel: 'sms',
    direction: 'inbound',
    body: 'Can I schedule a consultation?',
  });
  const state = Object.assign(new ConversationAiState(), {
    tenantId,
    leadId: lead.id,
    ownershipStatus: 'ai_handling',
  });
  const settings = Object.assign(new WorkspaceAiSettings(), {
    tenantId,
    aiEnabled: true,
    aiPaused: false,
    responseMode: 'controlled_autopilot',
  });
  const knowledge = Object.assign(new BrokerageKnowledge(), {
    tenantId,
    approvalStatus: 'approved',
  });
  const run = Object.assign(new AiRun(), {
    id: '00000000-0000-4000-8000-000000000030',
    tenantId,
    leadId: lead.id,
    triggeringMessageId: trigger.id,
  });
  const repositories = {
    leads: {
      findOne: jest.fn().mockResolvedValue(lead),
      save: jest.fn(async (value) => value),
    },
    messages: {
      findOne: jest.fn().mockResolvedValue(trigger),
      find: jest.fn().mockResolvedValue([trigger]),
    },
    states: {
      findOne: jest.fn().mockResolvedValue(state),
      save: jest.fn(async (value) => value),
    },
    settings: { findOne: jest.fn().mockResolvedValue(settings) },
    knowledge: { findOne: jest.fn().mockResolvedValue(knowledge) },
    tenantSettings: {
      findOne: jest.fn().mockResolvedValue({
        bookingLink: 'https://calendly.com/lakeview/consult',
        bookingLinkVerifiedAt: null,
      }),
    },
    platform: {
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new PlatformAiControl(), {
          id: 'global',
          paused: false,
        }),
      ),
    },
    appointments: { findOne: jest.fn().mockResolvedValue(null) },
  };
  const dependencies = {
    compliance: {
      communicationEligibility: jest.fn().mockResolvedValue({ allowed: true }),
    },
    entitlements: {
      evaluate: jest.fn().mockResolvedValue({ allowed: true, reasons: [] }),
    },
    clientOperations: {
      createAppointment: jest.fn(),
      updateAppointment: jest.fn(),
      createHandoff: jest.fn(),
    },
    notifications: { createForTenant: jest.fn() },
  };
  const service = new AiToolService(
    repositories.leads as any,
    repositories.messages as any,
    repositories.states as any,
    repositories.settings as any,
    repositories.knowledge as any,
    repositories.tenantSettings as any,
    repositories.platform as any,
    repositories.appointments as any,
    dependencies.compliance as any,
    dependencies.entitlements as any,
    dependencies.clientOperations as any,
    dependencies.notifications as any,
  );
  return {
    context: {
      run,
      lead,
      triggeringMessage: trigger,
      settings,
      knowledge,
      state,
      channel: 'sms' as const,
    },
    repositories,
    dependencies,
    service,
  };
}

describe('AI tool allowlist and validation', () => {
  it('blocks prompt-injection attempts to invoke a non-allowlisted tool', async () => {
    const item = fixture();
    await expect(
      item.service.execute(
        item.context,
        {
          name: 'run_sql' as any,
          arguments: JSON.stringify({ sql: 'SELECT * FROM users' }),
        },
        0,
      ),
    ).resolves.toMatchObject({
      status: 'blocked',
      code: 'TOOL_NOT_ALLOWLISTED',
    });
    expect(item.repositories.leads.findOne).not.toHaveBeenCalled();
  });

  it('blocks malformed tool arguments as a validation result', async () => {
    const item = fixture();
    await expect(
      item.service.execute(
        item.context,
        {
          name: 'update_lead_qualification',
          arguments: '{not-json',
        },
        0,
      ),
    ).resolves.toMatchObject({
      status: 'blocked',
      code: 'TOOL_VALIDATION_FAILED',
    });
    expect(item.repositories.leads.save).not.toHaveBeenCalled();
  });

  it('will not return an unverified booking link', async () => {
    const item = fixture();
    await expect(
      item.service.execute(
        item.context,
        {
          name: 'send_verified_booking_link',
          arguments: '{}',
        },
        0,
      ),
    ).resolves.toMatchObject({
      status: 'blocked',
      code: 'BOOKING_LINK_NOT_VERIFIED',
    });
  });

  it('revalidates tenant ownership immediately before tool execution', async () => {
    const item = fixture();
    item.repositories.leads.findOne.mockResolvedValueOnce(null);
    await expect(
      item.service.execute(
        item.context,
        {
          name: 'get_lead_context',
          arguments: '{}',
        },
        0,
      ),
    ).resolves.toMatchObject({
      status: 'blocked',
      code: 'TENANT_CONTEXT_INVALID',
    });
  });
});
