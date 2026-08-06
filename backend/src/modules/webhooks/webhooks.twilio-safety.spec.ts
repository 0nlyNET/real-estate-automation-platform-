import { UnauthorizedException } from "@nestjs/common";
import { createHmac } from "crypto";
import { ComplianceEvent } from "../compliance/compliance-event.entity";
import { ComplianceOptOut } from "../compliance/compliance-optout.entity";
import { LeadConsentRecord } from "../compliance/lead-consent-record.entity";
import { LeadEvent } from "../leads/lead-event.entity";
import { Lead } from "../leads/lead.entity";
import { Message } from "../messaging/message.entity";
import { TwilioInboundMessage } from "./twilio-inbound-message.entity";
import { TwilioInboundBody, WebhooksService } from "./webhooks.service";

const webhookUrl =
  "https://api.example.com/api/v1/telephony/twilio/sms-callback";
const authToken = "test-auth-token";

function signature(body: Record<string, unknown>): string {
  const payload =
    webhookUrl +
    Object.keys(body)
      .sort()
      .map((key) => `${key}${String(body[key] ?? "")}`)
      .join("");
  return createHmac("sha1", authToken).update(payload).digest("base64");
}

function harness(
  options: {
    body?: Partial<TwilioInboundBody>;
    routed?: boolean;
    candidates?: Lead[];
    duplicate?: boolean;
    failInboundMessage?: boolean;
    tenantId?: string;
    leadId?: string;
  } = {},
) {
  const tenantId = options.tenantId ?? "11111111-1111-4111-8111-111111111111";
  const lead = Object.assign(new Lead(), {
    id: options.leadId ?? "22222222-2222-4222-8222-222222222222",
    tenantId,
    fullName: "Jordan Lead",
    phone: "+14155550101",
    communicationStatus: "active",
    sequenceStatus: "active",
  });
  const body: TwilioInboundBody = {
    From: "+14155550101",
    To: "+14155550999",
    Body: "Hello, I am interested.",
    MessageSid: "SM-safety-1",
    MessagingServiceSid: "MG-test",
    ...options.body,
  };
  const inboundRepository = {
    findOne: jest.fn().mockResolvedValue(
      options.duplicate
        ? Object.assign(new TwilioInboundMessage(), {
            id: "inbound-existing",
            tenantId,
            leadId: lead.id,
            messageSid: body.MessageSid,
            isOptOut: true,
            processingResult: "opt_out_applied",
          })
        : null,
    ),
    create: jest.fn((value) =>
      Object.assign(new TwilioInboundMessage(), value),
    ),
    save: jest.fn(async (value) =>
      Object.assign(value, { id: value.id || "inbound-new" }),
    ),
  };
  const messageRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => Object.assign(new Message(), value)),
    save: jest.fn(async (value) => {
      if (options.failInboundMessage) throw new Error("message write failed");
      return Object.assign(value, { id: "message-inbound" });
    }),
  };
  const candidates = options.candidates ?? [lead];
  const leadBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(candidates),
  };
  const leadRepository = {
    createQueryBuilder: jest.fn(() => leadBuilder),
    findOne: jest.fn(
      async ({ where }) =>
        candidates.find(
          (candidate) =>
            candidate.id === where.id && candidate.tenantId === where.tenantId,
        ) ?? null,
    ),
    save: jest.fn(async (value) => value),
  };
  const leadEventRepository = {
    create: jest.fn((value) => Object.assign(new LeadEvent(), value)),
    save: jest.fn(async (value) => value),
  };
  const optOutRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const consentRepository = {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const complianceEventRepository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const manager = {
    query: jest.fn(async (sql: string, _parameters?: unknown[]) => {
      if (sql.includes("UPDATE messages")) {
        return [{ id: "pending-sms" }, { id: "pending-email" }];
      }
      return [];
    }),
    getRepository: jest.fn((entity) => {
      if (entity === TwilioInboundMessage) return inboundRepository;
      if (entity === Message) return messageRepository;
      if (entity === Lead) return leadRepository;
      if (entity === LeadEvent) return leadEventRepository;
      if (entity === ComplianceOptOut) return optOutRepository;
      if (entity === LeadConsentRecord) return consentRepository;
      if (entity === ComplianceEvent) return complianceEventRepository;
      throw new Error(`Unexpected repository: ${String(entity)}`);
    }),
  };
  const dataSource = {
    transaction: jest.fn(async (work) => work(manager)),
  };
  const credentials = {
    findOne: jest.fn().mockResolvedValue(
      options.routed === false
        ? null
        : {
            provider: "twilio",
            routingKey: body.To,
            encryptedValue: JSON.stringify({ connected: true, authToken }),
            tenant: { id: tenantId },
          },
    ),
    find: jest.fn().mockResolvedValue([]),
  };
  const compliance = {
    recordEvent: jest.fn().mockResolvedValue({}),
  };
  const sequences = { stopForLead: jest.fn().mockResolvedValue(undefined) };
  const ai = {
    acceptInbound: jest.fn().mockResolvedValue({ status: "queued" }),
  };
  const service = new WebhooksService(
    dataSource as never,
    credentials as never,
    compliance as never,
    sequences as never,
    {} as never,
    ai as never,
  );
  return {
    service,
    tenantId,
    lead,
    body,
    manager,
    dataSource,
    credentials,
    compliance,
    sequences,
    ai,
    inboundRepository,
    messageRepository,
    leadRepository,
    leadBuilder,
    leadEventRepository,
    optOutRepository,
    consentRepository,
    complianceEventRepository,
  };
}

describe("Twilio inbound safety transaction", () => {
  const originalUrl = process.env.TWILIO_WEBHOOK_URL;

  beforeEach(() => {
    process.env.TWILIO_WEBHOOK_URL = webhookUrl;
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.TWILIO_WEBHOOK_URL;
    else process.env.TWILIO_WEBHOOK_URL = originalUrl;
  });

  it("rejects an invalid signature before opening a mutation transaction", async () => {
    const item = harness();
    await expect(
      item.service.handleTwilioInbound(item.body, {
        "x-twilio-signature": "invalid",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(item.dataSource.transaction).not.toHaveBeenCalled();
    expect(item.leadRepository.save).not.toHaveBeenCalled();
    expect(item.compliance.recordEvent).toHaveBeenCalledWith(
      item.tenantId,
      expect.objectContaining({ type: "twilio_signature_rejected" }),
    );
  });

  it("atomically opts out the lead and cancels only unsent tenant-scoped jobs", async () => {
    const item = harness({ body: { Body: " STOP!!! " } });
    await expect(
      item.service.handleTwilioInbound(item.body, {
        "x-twilio-signature": signature(item.body),
      }),
    ).resolves.toEqual({ status: "opted_out" });

    expect(item.lead).toMatchObject({
      communicationStatus: "opted_out",
      optOutSource: "twilio_inbound_sms",
      sequenceStatus: "stopped",
    });
    expect(item.lead.optedOutAt).toBeInstanceOf(Date);
    expect(item.optOutRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: item.tenantId,
        channel: "sms",
        value: "14155550101",
      }),
    );
    expect(item.consentRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: item.tenantId,
        leadId: item.lead.id,
      }),
      expect.objectContaining({ status: "revoked" }),
    );
    const cancellation = item.manager.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE messages"),
    );
    expect(String(cancellation?.[0])).toContain(
      "status IN ('created', 'queued', 'pending', 'scheduled', 'sending')",
    );
    expect(String(cancellation?.[0])).toContain(
      "provider_submission_started_at IS NULL",
    );
    expect(cancellation?.[1]?.slice(0, 2)).toEqual([
      item.lead.id,
      item.tenantId,
    ]);
    expect(item.ai.acceptInbound).not.toHaveBeenCalled();
    expect(item.leadEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "sms_opt_out_received" }),
    );
  });

  it("honors Twilio OptOutType before application phrase matching", async () => {
    const item = harness({
      body: { Body: "I changed my mind", OptOutType: "STOP" },
    });
    await expect(
      item.service.handleTwilioInbound(item.body, {
        "x-twilio-signature": signature(item.body),
      }),
    ).resolves.toEqual({ status: "opted_out" });
  });

  it("records a normal reply and queues AI only after commit", async () => {
    const item = harness();
    await expect(
      item.service.handleTwilioInbound(item.body, {
        "x-twilio-signature": signature(item.body),
      }),
    ).resolves.toEqual({ status: "ok" });
    expect(item.sequences.stopForLead).toHaveBeenCalledWith(
      item.tenantId,
      item.lead.id,
      "reply",
    );
    expect(item.ai.acceptInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: item.tenantId,
        leadId: item.lead.id,
        channel: "sms",
      }),
    );
  });

  it("deduplicates MessageSid without reapplying opt-out side effects", async () => {
    const item = harness({ duplicate: true, body: { Body: "STOP" } });
    await expect(
      item.service.handleTwilioInbound(item.body, {
        "x-twilio-signature": signature(item.body),
      }),
    ).resolves.toEqual({ status: "duplicate" });
    expect(item.messageRepository.save).not.toHaveBeenCalled();
    expect(item.leadRepository.save).not.toHaveBeenCalled();
    expect(item.optOutRepository.save).not.toHaveBeenCalled();
  });

  it("resolves the tenant by inbound To before querying a shared sender number", async () => {
    const first = harness();
    const second = harness({
      tenantId: "55555555-5555-4555-8555-555555555555",
      leadId: "44444444-4444-4444-8444-444444444444",
      body: { To: "+14155550888", MessageSid: "SM-safety-2" },
    });
    for (const item of [first, second]) {
      await item.service.handleTwilioInbound(item.body, {
        "x-twilio-signature": signature(item.body),
      });
      expect(item.leadBuilder.where).toHaveBeenCalledWith(
        "lead.tenantId = :tenantId",
        { tenantId: item.tenantId },
      );
      expect(item.leadRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: item.tenantId }),
      );
    }
    expect(first.credentials.findOne).toHaveBeenCalledWith({
      where: { provider: "twilio", routingKey: "+14155550999" },
      relations: ["tenant"],
    });
    expect(second.credentials.findOne).toHaveBeenCalledWith({
      where: { provider: "twilio", routingKey: "+14155550888" },
      relations: ["tenant"],
    });
    expect(first.lead.phone).toBe(second.lead.phone);
    expect(first.lead.tenantId).not.toBe(second.lead.tenantId);
    expect(first.lead.id).not.toBe(second.lead.id);
  });

  it("acknowledges missing routing and ambiguous matches without mutating leads", async () => {
    const unrouted = harness({ routed: false });
    await expect(
      unrouted.service.handleTwilioInbound(unrouted.body, {
        "x-twilio-signature": signature(unrouted.body),
      }),
    ).resolves.toEqual({ status: "ignored" });
    expect(unrouted.dataSource.transaction).not.toHaveBeenCalled();

    const leadTwo = Object.assign(new Lead(), {
      id: "66666666-6666-4666-8666-666666666666",
      tenantId: unrouted.tenantId,
      phone: "+14155550101",
    });
    const ambiguous = harness({ candidates: [unrouted.lead, leadTwo] });
    await expect(
      ambiguous.service.handleTwilioInbound(ambiguous.body, {
        "x-twilio-signature": signature(ambiguous.body),
      }),
    ).resolves.toEqual({ status: "ignored" });
    expect(ambiguous.leadRepository.save).not.toHaveBeenCalled();
    expect(ambiguous.complianceEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: "twilio_inbound_ambiguous_lead" }),
    );
  });

  it("propagates persistence failure so the database transaction can roll back", async () => {
    const item = harness({ failInboundMessage: true, body: { Body: "STOP" } });
    await expect(
      item.service.handleTwilioInbound(item.body, {
        "x-twilio-signature": signature(item.body),
      }),
    ).rejects.toThrow("message write failed");
    expect(item.sequences.stopForLead).not.toHaveBeenCalled();
    expect(item.ai.acceptInbound).not.toHaveBeenCalled();
  });
});
