import { MODULE_METADATA } from '@nestjs/common/constants';

import { LeadsModule } from './leads.module';
import { AiModule } from '../ai/ai.module';
import { AiConversationService } from '../ai/ai-conversation.service';
import { Lead } from './lead.entity';
import { LeadsService } from './leads.service';

/**
 * Runtime regression tests for the AI first-response launch blocker
 * (2026-09-27) and its hardening boundary.
 *
 * Root cause (PR #106): LeadsModule did not import AiModule, so the
 * @Optional() AiConversationService in LeadsService was injected as
 * `undefined` and `this.aiConversation?.acceptLead(...)` silently did
 * nothing — no ai_run was ever created.
 *
 * Hardening: now that acceptLead() actually executes, an unexpected throw
 * must not fail lead intake. The boundary is fail-open for lead capture and
 * fail-closed for automated outbound messaging.
 */

function resolveImports(moduleClass: any): any[] {
  const imports: unknown[] =
    Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) || [];
  return imports.map((imp: any) =>
    imp && typeof imp.forwardRef === 'function' ? imp.forwardRef() : imp,
  );
}

interface Harness {
  service: LeadsService;
  persisted: Lead[];
  leadEvents: any[];
  acceptLead: jest.Mock;
  aiCalls: string[];
  queueInstantResponses: jest.Mock;
  createMessage: jest.Mock;
  startForLead: jest.Mock;
  createTask: jest.Mock;
}

function buildService(aiImpl: (event: any) => Promise<any>): Harness {
  const persisted: Lead[] = [];
  const leadEvents: any[] = [];
  const aiCalls: string[] = [];

  const leadsRepo = {
    create: jest.fn((value: any) => value),
    findOne: jest.fn(async () => null),
    save: jest.fn(async (value: any) => {
      const row = { ...value, id: value.id ?? `lead-${persisted.length + 1}` };
      persisted.push(row);
      return row;
    }),
  };
  const eventsRepo = {
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => {
      leadEvents.push(value);
      return value;
    }),
  };
  const stageRepo = {
    create: jest.fn((value: any) => value),
    save: jest.fn(async (value: any) => value),
  };
  const acceptLead = jest.fn(async (event: any) => {
    aiCalls.push('acceptLead');
    return aiImpl(event);
  });
  // The mock AI surface exposes ONLY acceptLead. Any other AI-subsystem call
  // during intake would surface here as an unexpected property access.
  const aiConversation = { acceptLead } as unknown as AiConversationService;

  const queueInstantResponses = jest.fn(async () => undefined);
  const createMessage = jest.fn(async () => undefined);
  const startForLead = jest.fn(async () => undefined);
  const createTask = jest.fn(async (task: any) => task);

  const service = new LeadsService(
    leadsRepo as any,
    eventsRepo as any,
    stageRepo as any,
    { findOne: jest.fn() } as any, // users
    { findOne: jest.fn() } as any, // tenant settings
    { findOne: jest.fn() } as any, // teams
    { findById: jest.fn(async (id: string) => ({ id, lifecycleStatus: 'ACTIVE' })) } as any,
    { queueInstantResponses, createMessage } as any, // messaging
    { startForLead } as any, // sequences
    { routeLead: jest.fn(async () => null) } as any, // routing
    { recordLeadConsent: jest.fn(async () => undefined) } as any, // compliance
    undefined, // notifications (@Optional)
    undefined, // limits (@Optional)
    undefined, // dataSource (@Optional) -> withDedupLock runs inline
    { publish: jest.fn(async () => undefined) } as any, // crmEvents (@Optional)
    aiConversation, // aiConversation (@Optional) — provided, must be used
    { createTask } as any, // operations (@Optional, @Global module)
  );

  return {
    service,
    persisted,
    leadEvents,
    acceptLead,
    aiCalls,
    queueInstantResponses,
    createMessage,
    startForLead,
    createTask,
  };
}

const intakePayload = {
  fullName: 'Boundary Test Lead',
  email: 'boundary-test@example.com',
  phone: '+15550001111',
};

describe('LeadsModule AI wiring', () => {
  it('imports AiModule and AiModule exports AiConversationService, so DI resolves a real service', () => {
    expect(resolveImports(LeadsModule)).toContain(AiModule);
    const aiExports: unknown[] =
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, AiModule) || [];
    expect(aiExports).toContain(AiConversationService);
  });
});

describe('AI first-response boundary', () => {
  it('successful intake invokes acceptLead and skips the template fallback', async () => {
    const h = buildService(async () => ({
      status: 'queued',
      runId: 'run-1',
      channel: 'email',
    }));

    const saved = await h.service.intake('tenant-1', { ...intakePayload });

    expect(h.persisted).toHaveLength(1);
    expect(saved.id).toBe(h.persisted[0].id);
    expect(h.acceptLead).toHaveBeenCalledTimes(1);
    expect(h.acceptLead).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      leadId: saved.id,
    });
    // AI took the lead: no deterministic-template fallback, delayed sequences.
    expect(h.queueInstantResponses).not.toHaveBeenCalled();
    expect(h.startForLead).toHaveBeenCalledWith(expect.anything(), {
      minimumDelayMinutes: 15,
    });
  });

  it('an acceptLead throw keeps the persisted lead and intake still succeeds', async () => {
    const h = buildService(async () => {
      throw new Error('provider down');
    });

    let saved: Lead | undefined;
    await expect(
      (async () => {
        saved = await h.service.intake('tenant-1', { ...intakePayload });
      })(),
    ).resolves.toBeUndefined();

    // Fail-open for lead capture: the lead remains persisted, intake returns it.
    expect(h.persisted).toHaveLength(1);
    expect(saved!.id).toBe(h.persisted[0].id);
    expect(saved!.fullName).toBe('Boundary Test Lead');
  });

  it('surfaces the AI failure through the operational event log and operator tasks', async () => {
    const h = buildService(async () => {
      throw new Error('provider down');
    });

    await h.service.intake('tenant-1', { ...intakePayload });

    const failureEvents = h.leadEvents.filter((e) => e.eventType === 'ai_accept_failed');
    expect(failureEvents).toHaveLength(1);
    expect(failureEvents[0].metadata.error).toContain('provider down');
    expect(failureEvents[0].metadata.tenantId).toBe('tenant-1');

    expect(h.createTask).toHaveBeenCalledTimes(1);
    expect(h.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        category: 'ai_accept_failure',
      }),
    );
  });

  it('produces no AI-generated outbound from the failed attempt; only the approved template fallback runs', async () => {
    const h = buildService(async () => {
      throw new Error('provider down');
    });

    await h.service.intake('tenant-1', { ...intakePayload });

    // The failed AI attempt made exactly one subsystem call (acceptLead) and
    // produced nothing — no ai_run, no AI message. The only outbound action is
    // the pre-approved deterministic template fallback.
    expect(h.aiCalls).toEqual(['acceptLead']);
    expect(h.queueInstantResponses).toHaveBeenCalledTimes(1);
    expect(h.createMessage).not.toHaveBeenCalled();
    // Not AI-queued, so sequences start without the AI delay.
    expect(h.startForLead).toHaveBeenCalledWith(expect.anything(), {
      minimumDelayMinutes: 0,
    });
  });
});
