import { Appointment } from "../client-operations/appointment.entity";
import { LeadEvent } from "../leads/lead-event.entity";
import { Lead } from "../leads/lead.entity";
import { TenantSettings } from "../settings/tenant-settings.entity";
import { Tenant } from "../tenants/tenant.entity";
import { Message } from "./message.entity";
import {
  MessageSafetyInput,
  MessageSafetyService,
} from "./message-safety.service";

function harness(
  options: {
    lead?: Partial<Lead>;
    tenant?: Partial<Tenant>;
    settings?: Partial<TenantSettings> | null;
    job?: Partial<Message> | null;
    noShow?: boolean;
    entitlementReasons?: string[];
    quietHours?: { enabled: boolean; startMinute: number; endMinute: number };
    consent?: { allowed: boolean; code?: string; reason?: string };
  } = {},
) {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const lead = Object.assign(new Lead(), {
    id: "22222222-2222-4222-8222-222222222222",
    tenantId,
    fullName: "Jordan Lead",
    phone: "+14155550101",
    email: "jordan@example.com",
    smsEligible: true,
    emailEligible: true,
    communicationStatus: "active",
    stage: "new",
    ...options.lead,
  });
  const tenant = Object.assign(new Tenant(), {
    id: tenantId,
    status: "active",
    lifecycleStatus: "ACTIVE",
    ...options.tenant,
  });
  const settings =
    options.settings === null
      ? null
      : Object.assign(new TenantSettings(), {
          tenantId,
          timeZone: "America/New_York",
          timeZoneVerifiedAt: new Date("2026-08-01T00:00:00.000Z"),
          bookingLink: "https://cal.example.com/jordan",
          bookingLinkVerificationStatus: "verified",
          bookingLinkVerifiedAt: new Date("2026-08-01T00:00:00.000Z"),
          bookingLinkVerificationExpiresAt: new Date(
            "2026-12-01T00:00:00.000Z",
          ),
          automationsEnabled: true,
          ...options.settings,
        });
  const job =
    options.job === null
      ? null
      : Object.assign(new Message(), {
          id: "33333333-3333-4333-8333-333333333333",
          leadId: lead.id,
          lead,
          channel: "sms",
          direction: "outbound",
          body: "Approved message",
          status: "sending",
          authorship: "system",
          communicationType: "sequence",
          requiresBookingLink: false,
          jobPurpose: "ordinary",
          blockedReasonHistory: [],
          safetyRuleIds: [],
          ...options.job,
        });
  const messageBuilder = {
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(job),
  };
  const messageRepository = {
    createQueryBuilder: jest.fn(() => messageBuilder),
    save: jest.fn(async (value) => value),
  };
  const leadEventRepository = {
    create: jest.fn((value) => Object.assign(new LeadEvent(), value)),
    save: jest.fn(async (value) => value),
  };
  const compliance = {
    getQuietHours: jest.fn().mockResolvedValue(
      options.quietHours ?? {
        enabled: false,
        startMinute: 1_260,
        endMinute: 480,
      },
    ),
    communicationEligibility: jest.fn().mockResolvedValue(
      options.consent ?? {
        allowed: true,
      },
    ),
  };
  const entitlements = {
    evaluate: jest.fn().mockResolvedValue({
      allowed: !options.entitlementReasons?.length,
      reasons: options.entitlementReasons ?? [],
    }),
  };
  const service = new MessageSafetyService(
    { findOne: jest.fn().mockResolvedValue(lead) } as never,
    messageRepository as never,
    { findOne: jest.fn().mockResolvedValue(tenant) } as never,
    { findOne: jest.fn().mockResolvedValue(settings) } as never,
    {
      findOne: jest.fn().mockResolvedValue(
        options.noShow
          ? Object.assign(new Appointment(), {
              tenantId,
              leadId: lead.id,
              status: "no_show",
            })
          : null,
      ),
    } as never,
    leadEventRepository as never,
    compliance as never,
    entitlements as never,
  );
  const input: MessageSafetyInput = {
    leadId: lead.id,
    clientId: tenantId,
    jobId: job?.id,
    communicationType: "sequence",
    requiresBookingLink: false,
    now: new Date("2026-08-06T16:00:00.000Z"),
  };
  return {
    service,
    input,
    lead,
    tenant,
    settings,
    job,
    messageRepository,
    leadEventRepository,
    compliance,
  };
}

describe("MessageSafetyService", () => {
  it.each([
    ["blocked", { communicationStatus: "blocked" }, "LEAD_BLOCKED"],
    ["paused", { communicationStatus: "paused" }, "LEAD_PAUSED"],
    ["opted out", { communicationStatus: "opted_out" }, "LEAD_OPTED_OUT"],
    ["lost", { stage: "lost" }, "LEAD_LOST"],
  ])("blocks a %s lead", async (_label, lead, ruleId) => {
    const item = harness({ lead: lead as Partial<Lead> });
    const result = await item.service.evaluateMessageSafety(item.input);
    expect(result).toMatchObject({ allowed: false });
    expect(result.ruleIds).toContain(ruleId);
  });

  it("blocks ordinary no-show nurture but permits an approved reschedule workflow", async () => {
    const ordinary = harness({ noShow: true });
    await expect(
      ordinary.service.evaluateMessageSafety(ordinary.input),
    ).resolves.toMatchObject({
      allowed: false,
      ruleIds: expect.arrayContaining(["NO_SHOW_NURTURE_BLOCKED"]),
    });

    const reschedule = harness({
      noShow: true,
      job: { jobPurpose: "no_show_reschedule" },
    });
    await expect(
      reschedule.service.evaluateMessageSafety(reschedule.input),
    ).resolves.toMatchObject({ allowed: true, ruleIds: [] });
  });

  it.each([
    ["suspended client", { lifecycleStatus: "SUSPENDED" }, "CLIENT_SUSPENDED"],
    ["paused client", { lifecycleStatus: "PAUSED" }, "CLIENT_PAUSED"],
    [
      "inactive organization",
      { lifecycleStatus: "CANCELED" },
      "CLIENT_INACTIVE",
    ],
  ])("blocks a %s state", async (_label, tenant, ruleId) => {
    const item = harness({ tenant: tenant as Partial<Tenant> });
    const result = await item.service.evaluateMessageSafety(item.input);
    expect(result.ruleIds).toContain(ruleId);
  });

  it.each([
    ["Automations are globally paused", "GLOBAL_AUTOMATION_PAUSED"],
    ["Client automation is disabled", "CLIENT_AUTOMATION_PAUSED"],
    ["Billing payment is inactive", "SERVICE_ENTITLEMENT_INACTIVE"],
  ])('maps entitlement failure "%s" to %s', async (reason, ruleId) => {
    const item = harness({ entitlementReasons: [reason] });
    const result = await item.service.evaluateMessageSafety(item.input);
    expect(result.ruleIds).toContain(ruleId);
  });

  it.each([
    ["missing", { timeZone: "" }, "TIME_ZONE_MISSING"],
    ["invalid", { timeZone: "Mars/Olympus" }, "TIME_ZONE_INVALID"],
    ["unverified", { timeZoneVerifiedAt: null }, "TIME_ZONE_UNVERIFIED"],
  ])("blocks a %s client time zone", async (_label, settings, ruleId) => {
    const item = harness({ settings: settings as Partial<TenantSettings> });
    const result = await item.service.evaluateMessageSafety(item.input);
    expect(result.ruleIds).toContain(ruleId);
  });

  it("blocks inside same-day and overnight quiet-hour windows", async () => {
    const sameDay = harness({
      settings: { timeZone: "UTC" },
      quietHours: { enabled: true, startMinute: 540, endMinute: 1_020 },
    });
    const overnight = harness({
      settings: { timeZone: "UTC" },
      quietHours: { enabled: true, startMinute: 1_320, endMinute: 480 },
    });
    await expect(
      sameDay.service.evaluateMessageSafety({
        ...sameDay.input,
        now: new Date("2026-08-06T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      ruleIds: expect.arrayContaining(["QUIET_HOURS"]),
    });
    await expect(
      overnight.service.evaluateMessageSafety({
        ...overnight.input,
        now: new Date("2026-08-06T23:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      ruleIds: expect.arrayContaining(["QUIET_HOURS"]),
    });
  });

  it("requires a currently verified safe link only for booking messages", async () => {
    const missing = harness({ settings: { bookingLink: "" } });
    await expect(
      missing.service.evaluateMessageSafety({
        ...missing.input,
        requiresBookingLink: true,
      }),
    ).resolves.toMatchObject({
      ruleIds: expect.arrayContaining(["BOOKING_LINK_INVALID"]),
    });

    const unverified = harness({
      settings: {
        bookingLinkVerificationStatus: "unverified",
        bookingLinkVerifiedAt: null,
      },
    });
    await expect(
      unverified.service.evaluateMessageSafety({
        ...unverified.input,
        requiresBookingLink: true,
      }),
    ).resolves.toMatchObject({
      ruleIds: expect.arrayContaining(["BOOKING_LINK_UNVERIFIED"]),
    });

    const unrelated = harness({ settings: { bookingLink: "" } });
    await expect(
      unrelated.service.evaluateMessageSafety(unrelated.input),
    ).resolves.toMatchObject({ allowed: true });
  });

  it.each([
    [
      "expired",
      {
        bookingLinkVerificationExpiresAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      "BOOKING_LINK_EXPIRED",
    ],
    [
      "revoked",
      {
        bookingLinkVerificationStatus: "revoked",
        bookingLinkRevokedAt: new Date("2026-08-02T00:00:00.000Z"),
      },
      "BOOKING_LINK_REVOKED",
    ],
    [
      "failed",
      { bookingLinkVerificationStatus: "failed" },
      "BOOKING_LINK_REVOKED",
    ],
  ])(
    "blocks a booking message with %s verification",
    async (_label, settings, ruleId) => {
      const item = harness({ settings: settings as Partial<TenantSettings> });
      const result = await item.service.evaluateMessageSafety({
        ...item.input,
        requiresBookingLink: true,
      });
      expect(result.ruleIds).toContain(ruleId);
    },
  );

  it.each([
    [
      "sms",
      { phone: "invalid", smsEligible: false },
      { channel: "sms" },
      "SMS_DESTINATION_INELIGIBLE",
    ],
    [
      "email",
      { email: "invalid", emailEligible: false },
      { channel: "email", communicationType: "email" },
      "EMAIL_DESTINATION_INELIGIBLE",
    ],
  ])(
    "blocks %s without an eligible destination",
    async (_label, lead, job, ruleId) => {
      const item = harness({
        lead: lead as Partial<Lead>,
        job: job as Partial<Message>,
      });
      const result = await item.service.evaluateMessageSafety({
        ...item.input,
        communicationType: _label === "email" ? "email" : "sms",
      });
      expect(result.ruleIds).toContain(ruleId);
    },
  );

  it("persists one human-readable reason history entry for repeated blocks", async () => {
    const item = harness({ lead: { communicationStatus: "blocked" } });
    const first = await item.service.evaluateMessageSafety(item.input);
    const second = await item.service.evaluateMessageSafety(item.input);

    expect(first.allowed).toBe(false);
    expect(second.allowed).toBe(false);
    expect(item.job).toMatchObject({
      status: "blocked",
      errorCode: "SAFETY_GUARDRAIL",
      safetyRuleIds: expect.arrayContaining(["LEAD_BLOCKED"]),
    });
    expect(item.job?.blockedReason).toContain("Lead communication is blocked");
    expect(item.job?.blockedReasonHistory).toHaveLength(1);
    expect(item.leadEventRepository.save).toHaveBeenCalledTimes(1);
  });

  it("keeps the required public boolean verifier available", async () => {
    const item = harness({ job: null });
    await expect(
      item.service.verifyMessageSafety(item.lead.id, item.tenant.id),
    ).resolves.toBe(true);
  });
});
