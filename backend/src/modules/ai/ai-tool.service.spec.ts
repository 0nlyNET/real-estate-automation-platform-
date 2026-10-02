import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { AiRun } from './ai-run.entity';
import { AiToolService } from './ai-tool.service';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { ConversationAiState } from './conversation-ai-state.entity';
import { PlatformAiControl } from './platform-ai-control.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';
import { ServiceUnavailableException } from '@nestjs/common';

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

  it('accepts tool arguments wrapped in markdown code fences', async () => {
    const item = fixture();
    item.context.settings.bookingBehavior = 'calendar_booking';
    item.dependencies.clientOperations.createAppointment.mockResolvedValue({ id: 'appointment-1' });
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    const fenced = '```json\n' + JSON.stringify({ startsAt }) + '\n```';
    await expect(
      item.service.execute(
        item.context,
        {
          name: 'create_or_update_appointment',
          arguments: fenced,
        },
        3,
      ),
    ).resolves.toMatchObject({
      status: 'executed',
      output: { appointmentId: 'appointment-1', created: true },
    });
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

  it('books only in calendar mode and passes a stable idempotency key to the real booking service', async () => {
    const item = fixture();
    item.context.settings.bookingBehavior = 'calendar_booking';
    item.dependencies.clientOperations.createAppointment.mockResolvedValue({ id: 'appointment-1' });
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    await expect(
      item.service.execute(
        item.context,
        {
          name: 'create_or_update_appointment',
          arguments: JSON.stringify({ startsAt }),
        },
        3,
      ),
    ).resolves.toMatchObject({
      status: 'executed',
      output: { appointmentId: 'appointment-1', created: true },
    });
    expect(item.dependencies.clientOperations.createAppointment).toHaveBeenCalledWith(
      item.context.run.tenantId,
      expect.objectContaining({
        leadId: item.context.lead.id,
        idempotencyKey: `ai-tool:${item.context.run.id}:3`,
      }),
      undefined,
      'conversation',
    );
    expect(item.dependencies.clientOperations.createAppointment.mock.calls[0][1]).not.toHaveProperty(
      'externalEventId',
    );
  });

  it.each(['Google Calendar', 'Microsoft Outlook', 'Calendly'])(
    'blocks the AI reply when %s cannot verify the booking',
    async (providerLabel) => {
    const item = fixture();
    item.context.settings.bookingBehavior = 'calendar_booking';
    item.dependencies.clientOperations.createAppointment.mockRejectedValue(
      new ServiceUnavailableException({
        code: 'APPOINTMENT_RECONCILIATION_PENDING',
        message: `${providerLabel} booking result is uncertain. Do not claim it is booked.`,
      }),
    );
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    await expect(
      item.service.execute(
        item.context,
        {
          name: 'create_or_update_appointment',
          arguments: JSON.stringify({ startsAt }),
        },
        0,
      ),
    ).resolves.toMatchObject({
      status: 'blocked',
      code: 'APPOINTMENT_RECONCILIATION_PENDING',
    });
    },
  );

  it('blocks AI booking times that do not include an explicit UTC offset', async () => {
    const item = fixture();
    item.context.settings.bookingBehavior = 'calendar_booking';
    await expect(
      item.service.execute(
        item.context,
        {
          name: 'create_or_update_appointment',
          arguments: JSON.stringify({ startsAt: '2026-11-01T01:30:00' }),
        },
        0,
      ),
    ).resolves.toMatchObject({
      status: 'blocked',
      reason: expect.stringMatching(/explicit UTC offset/i),
    });
    expect(item.dependencies.clientOperations.createAppointment).not.toHaveBeenCalled();
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

  it('passes controlledTest to entitlement gate for controlled-test runs', async () => {
    const item = fixture();
    const testRunId = '00000000-0000-4000-8000-000000000093';
    // Simulate a controlled-test run with testRunId in promptMetadata.
    (item.context.run as any).promptMetadata = { testRunId, channel: 'sms' };
    item.context.settings.bookingBehavior = 'calendar_booking';
    item.dependencies.clientOperations.createAppointment.mockResolvedValue({ id: 'appt-1' });
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    await item.service.execute(
      item.context,
      {
        name: 'create_or_update_appointment',
        arguments: JSON.stringify({ startsAt }),
      },
      3,
    );
    // The entitlement gate must receive controlledTest: true.
    expect(item.dependencies.entitlements.evaluate).toHaveBeenCalledWith(
      item.context.run.tenantId,
      'send_automated_sms',
      expect.any(Date),
      { controlledTest: true },
    );
  });

  it('passes controlledTest: false for ordinary runs without testRunId', async () => {
    const item = fixture();
    // No testRunId in promptMetadata or lead.
    (item.context.run as any).promptMetadata = { channel: 'sms' };
    item.context.settings.bookingBehavior = 'calendar_booking';
    item.dependencies.clientOperations.createAppointment.mockResolvedValue({ id: 'appt-2' });
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString();
    await item.service.execute(
      item.context,
      {
        name: 'create_or_update_appointment',
        arguments: JSON.stringify({ startsAt }),
      },
      3,
    );
    // The entitlement gate must receive controlledTest: false.
    expect(item.dependencies.entitlements.evaluate).toHaveBeenCalledWith(
      item.context.run.tenantId,
      'send_automated_sms',
      expect.any(Date),
      { controlledTest: false },
    );
  });
});

describe('update_lead_qualification contract', () => {
  function qualificationArgs(payload: unknown) {
    return {
      name: 'update_lead_qualification' as const,
      arguments: JSON.stringify(payload),
    };
  }

  it('executes a valid nested qualification payload', async () => {
    const item = fixture();
    const result = await item.service.execute(
      item.context,
      qualificationArgs({
        qualification: {
          intent: 'buyer',
          location: 'Elmwood Village',
          budget: '$450,000',
        },
      }),
      0,
    );
    expect(result).toMatchObject({
      status: 'executed',
      name: 'update_lead_qualification',
    });
    expect(result.output).toMatchObject({
      updatedFields: ['intent', 'location', 'budget'],
    });
    expect(item.repositories.leads.save).toHaveBeenCalled();
    expect(item.context.lead.qualificationData).toMatchObject({
      intent: 'buyer',
      location: 'Elmwood Village',
      budget: '$450,000',
    });
  });

  it('rejects flat arguments that skip the required qualification wrapper', async () => {
    const item = fixture();
    const result = await item.service.execute(
      item.context,
      qualificationArgs({
        intent: 'buyer',
        location: 'Elmwood Village',
        budget: '$450,000',
      }),
      0,
    );
    expect(result).toMatchObject({
      status: 'blocked',
      code: 'TOOL_VALIDATION_FAILED',
    });
    expect(String(result.reason)).toContain('qualification must be an object');
    expect(item.repositories.leads.save).not.toHaveBeenCalled();
  });

  it('repairs a double-encoded qualification string, then validates it', async () => {
    const item = fixture();
    const result = await item.service.execute(
      item.context,
      qualificationArgs({
        qualification: JSON.stringify({
          intent: 'buyer',
          location: 'Elmwood Village',
        }),
      }),
      0,
    );
    expect(result).toMatchObject({ status: 'executed' });
    expect(result.output).toMatchObject({ argsRepaired: true });
    expect(item.context.lead.qualificationData).toMatchObject({
      intent: 'buyer',
      location: 'Elmwood Village',
    });
  });

  it('still fails visibly when the repaired payload is invalid', async () => {
    const item = fixture();
    const result = await item.service.execute(
      item.context,
      qualificationArgs({
        qualification: JSON.stringify({ bedrooms: '3' }),
      }),
      0,
    );
    expect(result).toMatchObject({ status: 'blocked' });
    expect(String(result.reason)).toContain('Unsupported qualification field');
    expect(item.repositories.leads.save).not.toHaveBeenCalled();
  });

  it('rejects unsupported qualification fields such as bedrooms', async () => {
    const item = fixture();
    const result = await item.service.execute(
      item.context,
      qualificationArgs({
        qualification: { intent: 'buyer', bedrooms: '3' },
      }),
      0,
    );
    expect(result).toMatchObject({ status: 'blocked' });
    expect(String(result.reason)).toContain('Unsupported qualification field');
    expect(item.repositories.leads.save).not.toHaveBeenCalled();
  });

  it('rejects non-text qualification values', async () => {
    const item = fixture();
    const result = await item.service.execute(
      item.context,
      qualificationArgs({ qualification: { budget: 450000 } }),
      0,
    );
    expect(result).toMatchObject({ status: 'blocked' });
    expect(String(result.reason)).toContain('must be text or null');
    expect(item.repositories.leads.save).not.toHaveBeenCalled();
  });

  it('accepts null qualification values', async () => {
    const item = fixture();
    const result = await item.service.execute(
      item.context,
      qualificationArgs({ qualification: { timeline: null } }),
      0,
    );
    expect(result).toMatchObject({ status: 'executed' });
  });
});
