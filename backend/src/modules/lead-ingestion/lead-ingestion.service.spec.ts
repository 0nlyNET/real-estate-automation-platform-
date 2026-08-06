import { createHash } from "crypto";
import { UnauthorizedException } from "@nestjs/common";
import { LeadEvent } from "../leads/lead-event.entity";
import { Lead } from "../leads/lead.entity";
import { TenantSettings } from "../settings/tenant-settings.entity";
import { LeadIngestionEvent } from "./lead-ingestion-event.entity";
import { LeadIngestionService } from "./lead-ingestion.service";
import { RealtorLeadAdapter } from "./realtor-lead.adapter";
import { ZillowLeadAdapter } from "./zillow-lead.adapter";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function harness(keyTenants: Record<string, string> = { "key-a": "tenant-a" }) {
  const state = {
    leads: [] as Lead[],
    events: [] as LeadIngestionEvent[],
    leadEvents: [] as LeadEvent[],
    rolledBack: false,
  };
  let failEventPersistence = false;
  const eventRepository = {
    findOne: jest.fn(
      async ({ where }) =>
        state.events.find(
          (event) =>
            event.tenantId === where.tenantId &&
            event.provider === where.provider &&
            event.idempotencyKey === where.idempotencyKey,
        ) ?? null,
    ),
    create: jest.fn((value) => Object.assign(new LeadIngestionEvent(), value)),
    save: jest.fn(async (value: LeadIngestionEvent) => {
      if (failEventPersistence) throw new Error("ingestion event write failed");
      if (!value.id) value.id = `event-${state.events.length + 1}`;
      state.events.push(value);
      return value;
    }),
  };
  const leadRepository = {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    })),
    create: jest.fn((value) => Object.assign(new Lead(), value)),
    save: jest.fn(async (value: Lead) => {
      if (!value.id) value.id = `lead-${state.leads.length + 1}`;
      state.leads.push(value);
      return value;
    }),
  };
  const leadEventRepository = {
    create: jest.fn((value) => Object.assign(new LeadEvent(), value)),
    save: jest.fn(async (value: LeadEvent) => {
      state.leadEvents.push(value);
      return value;
    }),
  };
  const tenantSettingsRepository = {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    getRepository: jest.fn((entity) => {
      if (entity === LeadIngestionEvent) return eventRepository;
      if (entity === Lead) return leadRepository;
      if (entity === LeadEvent) return leadEventRepository;
      if (entity === TenantSettings) return tenantSettingsRepository;
      throw new Error(`Unexpected repository: ${String(entity)}`);
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (work) => {
      const snapshot = {
        leads: state.leads.length,
        events: state.events.length,
        leadEvents: state.leadEvents.length,
      };
      try {
        return await work(manager);
      } catch (error) {
        state.leads.length = snapshot.leads;
        state.events.length = snapshot.events;
        state.leadEvents.length = snapshot.leadEvents;
        state.rolledBack = true;
        throw error;
      }
    }),
  };
  const settingsRepository = {
    findOne: jest.fn(async ({ where }) => {
      const entry = Object.entries(keyTenants).find(
        ([key]) => digest(key) === where.intakeApiKeyHash,
      );
      return entry ? { tenantId: entry[1] } : null;
    }),
  };
  const service = new LeadIngestionService(
    dataSource as never,
    settingsRepository as never,
    { findOne: jest.fn(), find: jest.fn() } as never,
    { count: jest.fn().mockResolvedValue(1) } as never,
    new ZillowLeadAdapter(),
    new RealtorLeadAdapter(),
  );

  return {
    service,
    state,
    manager,
    leadRepository,
    eventRepository,
    leadEventRepository,
    setFailEventPersistence(value: boolean) {
      failEventPersistence = value;
    },
  };
}

describe("LeadIngestionService", () => {
  it("atomically accepts an authenticated Zillow lead and records its audit event", async () => {
    const item = harness();
    await expect(
      item.service.ingest({
        headers: { "x-ingestion-key": "key-a", "x-lead-provider": "zillow" },
        correlationId: "request-1",
        body: {
          providerLeadId: "zillow-1",
          fullName: "Jordan Buyer",
          email: "JORDAN@example.com",
        },
      }),
    ).resolves.toMatchObject({
      acknowledged: true,
      status: "accepted",
      eventId: "event-1",
      leadId: "lead-1",
    });

    expect(item.state.leads[0]).toMatchObject({
      tenantId: "tenant-a",
      provider: "zillow",
      providerLeadId: "zillow-1",
      email: "jordan@example.com",
      emailEligible: true,
      smsEligible: false,
    });
    expect(item.state.events[0].payloadMetadata).toEqual(
      expect.objectContaining({ hasEmail: true }),
    );
    expect(JSON.stringify(item.state.events[0].payloadMetadata)).not.toContain(
      "jordan@example.com",
    );
    expect(item.state.leadEvents[0]).toMatchObject({
      eventType: "provider_lead_ingested",
    });
    expect(item.manager.query).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [expect.stringContaining("lead-ingestion:tenant-a:zillow:provider:")],
    );
  });

  it("acknowledges invalid contact data without creating an active lead", async () => {
    const item = harness();
    const result = await item.service.ingest({
      headers: { authorization: "Bearer key-a", "x-lead-provider": "realtor" },
      correlationId: "request-validation",
      body: {
        leadId: "realtor-invalid",
        email: "invalid",
        phone: "123",
      },
    });

    expect(result).toMatchObject({
      acknowledged: true,
      status: "rejected_validation",
      leadId: null,
      validationError:
        "No valid contact channel: email is missing or invalid; phone is missing or invalid",
    });
    expect(item.state.leads).toHaveLength(0);
    expect(item.state.events[0]).toMatchObject({
      status: "failed_validation",
      correlationId: "request-validation",
      providerLeadId: "realtor-invalid",
    });
  });

  it("rejects a missing or invalid provider credential before opening a transaction", async () => {
    const item = harness();
    await expect(
      item.service.ingest({
        headers: { "x-lead-provider": "zillow" },
        correlationId: "request-no-key",
        body: { email: "valid@example.com" },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      item.service.ingest({
        headers: {
          "x-ingestion-key": "wrong",
          "x-lead-provider": "zillow",
        },
        correlationId: "request-wrong-key",
        body: { email: "valid@example.com" },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(item.state.events).toHaveLength(0);
    expect(item.manager.query).not.toHaveBeenCalled();
  });

  it("deduplicates provider retries but scopes provider IDs and phone values by tenant", async () => {
    const item = harness({ "key-a": "tenant-a", "key-b": "tenant-b" });
    const body = {
      providerLeadId: "shared-provider-id",
      fullName: "Shared Phone",
      phone: "+14155550101",
    };
    const invoke = (key: string) =>
      item.service.ingest({
        headers: { "x-ingestion-key": key, "x-lead-provider": "zillow" },
        correlationId: `request-${key}`,
        body,
      });

    await expect(invoke("key-a")).resolves.toMatchObject({
      status: "accepted",
    });
    await expect(invoke("key-a")).resolves.toMatchObject({
      status: "duplicate",
      leadId: "lead-1",
    });
    await expect(invoke("key-b")).resolves.toMatchObject({
      status: "accepted",
    });
    expect(item.state.leads).toHaveLength(2);
    expect(item.state.leads.map((lead) => lead.tenantId)).toEqual([
      "tenant-a",
      "tenant-b",
    ]);
  });

  it("rolls back the lead when its ingestion event cannot be persisted", async () => {
    const item = harness();
    item.setFailEventPersistence(true);
    await expect(
      item.service.ingest({
        headers: { "x-ingestion-key": "key-a", "x-lead-provider": "zillow" },
        correlationId: "request-rollback",
        body: { providerLeadId: "zillow-rollback", email: "valid@example.com" },
      }),
    ).rejects.toThrow("ingestion event write failed");
    expect(item.state.rolledBack).toBe(true);
    expect(item.state.leads).toHaveLength(0);
    expect(item.state.events).toHaveLength(0);
  });
});
