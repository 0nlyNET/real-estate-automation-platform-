import { ConversationInboxService } from "./conversation-inbox.service";
import { ConversationAiState } from "../ai/conversation-ai-state.entity";
import { WorkspaceAiSettings } from "../ai/workspace-ai-settings.entity";
import { BrokerageKnowledge } from "../ai/brokerage-knowledge.entity";
import { PlatformAiControl } from "../ai/platform-ai-control.entity";
import { LeadHandoff } from "../client-operations/lead-handoff.entity";
import { Lead } from "../leads/lead.entity";

describe("authoritative inbox AI status", () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousPause = process.env.GLOBAL_AUTOMATIONS_DISABLED;
  let state: any;
  let settings: any;
  let platform: any;
  let run: any;
  let handoff: any;
  let entitlement: any;
  let lead: any;
  let evaluate: jest.Mock;
  let service: ConversationInboxService;
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-only-ai-key";
    delete process.env.GLOBAL_AUTOMATIONS_DISABLED;
    state = { leadId: "lead", ownershipStatus: "ai_handling" };
    settings = {
      aiEnabled: true,
      responseMode: "controlled_autopilot",
      configurationApprovalStatus: "approved",
      identityLabel: "Test brokerage",
    };
    platform = { paused: false };
    run = null;
    handoff = null;
    entitlement = { allowed: true, reasons: [] };
    lead = { id: "lead", testRunId: null };
    const query: any = {};
    for (const method of [
      "distinctOn",
      "where",
      "andWhere",
      "orderBy",
      "addOrderBy",
    ])
      query[method] = jest.fn(() => query);
    query.getMany = jest.fn(async () => (run ? [run] : []));
    const source = {
      getRepository: (entity: unknown) => ({
        find: jest.fn(async () =>
          entity === ConversationAiState
            ? state
              ? [state]
              : []
            : entity === Lead
              ? [lead]
              : entity === LeadHandoff && handoff
                ? [handoff]
                : [],
        ),
        findOne: jest.fn(async () =>
          entity === WorkspaceAiSettings
            ? settings
            : entity === PlatformAiControl
              ? platform
              : entity === BrokerageKnowledge
                ? { approvalStatus: "approved" }
                : null,
        ),
        createQueryBuilder: () => query,
      }),
    };
    evaluate = jest.fn(async () => entitlement);
    service = new ConversationInboxService(source as any, { evaluate } as any);
  });
  afterEach(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousPause === undefined)
      delete process.env.GLOBAL_AUTOMATIONS_DISABLED;
    else process.env.GLOBAL_AUTOMATIONS_DISABLED = previousPause;
  });
  const status = async (service: ConversationInboxService) =>
    (
      await service.aiSummaries("tenant", [
        { leadId: "lead", channel: "email" },
      ])
    ).get("lead")?.aiStatus;

  it("matches runtime entitlement for controlled test leads without granting it to real leads", async () => {
    evaluate.mockImplementation(async (_tenant, _action, _now, options) => ({
      allowed: options?.controlledTest === true,
      reasons: options?.controlledTest
        ? []
        : ["Workspace lifecycle is TESTING"],
    }));
    expect(await status(service)).toBe("AI Paused");
    lead.testRunId = "persisted-test-run";
    expect(await status(service)).toBe("AI Active");
    expect(evaluate).toHaveBeenLastCalledWith(
      "tenant",
      "send_automated_email",
      expect.any(Date),
      { controlledTest: true },
    );
    await service.aiSummaries("tenant", [{ leadId: "lead", channel: "sms" }]);
    expect(evaluate).toHaveBeenLastCalledWith(
      "tenant",
      "send_automated_sms",
      expect.any(Date),
      { controlledTest: true },
    );
    entitlement = {
      allowed: false,
      reasons: ["Workspace lifecycle is SUSPENDED"],
    };
    evaluate.mockImplementation(async () => entitlement);
    expect(await status(service)).toBe("AI Paused");
  });

  it("reports active only when configured, approved and entitled", async () => {
    expect(await status(service)).toBe("AI Active");
    delete process.env.OPENAI_API_KEY;
    expect(await status(service)).toBe("Needs Attention");
  });
  it.each([
    "global",
    "platform",
    "workspace",
    "conversation",
    "suspension",
    "disabled",
  ])("respects %s pauses", async (scope) => {
    if (scope === "global") process.env.GLOBAL_AUTOMATIONS_DISABLED = "true";
    if (scope === "platform") platform.paused = true;
    if (scope === "workspace") settings.aiPaused = true;
    if (scope === "conversation") state.ownershipStatus = "paused";
    if (scope === "suspension")
      entitlement = {
        allowed: false,
        reasons: ["Workspace lifecycle is SUSPENDED"],
      };
    if (scope === "disabled") settings.aiEnabled = false;
    expect(await status(service)).toBe("AI Paused");
  });
  it("reflects human ownership and unresolved handoffs", async () => {
    state.ownershipStatus = "human_handling";
    expect(await status(service)).toBe("Human Takeover");
    handoff = { leadId: "lead", reason: "Review needed" };
    expect(await status(service)).toBe("Needs Attention");
  });
  it("shows failed, blocked, and draft runs as needing attention without reviving old failures after Resume AI", async () => {
    for (const runStatus of ["failed", "blocked", "drafted"]) {
      run = {
        leadId: "lead",
        status: runStatus,
        createdAt: new Date("2026-09-20T10:00:00Z"),
      };
      expect(await status(service)).toBe("Needs Attention");
    }
    state.returnedToAiAt = new Date("2026-09-20T11:00:00Z");
    expect(await status(service)).toBe("AI Active");
    state = null;
    expect(await status(service)).toBe("Needs Attention");
  });
});
