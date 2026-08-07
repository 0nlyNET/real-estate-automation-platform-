import { SettingsService, hashIntakeKey } from "./settings.service";
import { TenantSettings } from "./tenant-settings.entity";
import { BadRequestException } from "@nestjs/common";

describe("SettingsService intake keys", () => {
  let saved: TenantSettings | null;
  let service: SettingsService;
  let onboarding: { invalidateLaunchEvidence: jest.Mock };

  beforeEach(() => {
    saved = Object.assign(new TenantSettings(), {
      id: "settings-1",
      tenantId: "tenant-1",
      timeZone: "America/New_York",
      quietHoursStart: "21:00",
      quietHoursEnd: "08:00",
      bookingLink: "",
      automationsEnabled: true,
      roundRobinEnabled: false,
      facebookConnected: false,
    });

    const tenantSettingsRepo = {
      findOne: jest.fn(async () => saved),
      create: jest.fn(() => new TenantSettings()),
      save: jest.fn(async (value: TenantSettings) => {
        saved = value;
        return value;
      }),
    };

    onboarding = { invalidateLaunchEvidence: jest.fn().mockResolvedValue({}) };
    service = new SettingsService(
      tenantSettingsRepo as any,
      { findOne: jest.fn() } as any,
      { findOne: jest.fn(), create: jest.fn(), save: jest.fn() } as any,
      { assertAllowed: jest.fn() } as any,
      onboarding as any,
    );
  });

  it("returns a new key once and stores only its hash", async () => {
    const rotated = await service.rotateIntakeKey("tenant-1");

    expect(rotated.key).toMatch(/^rta_live_[A-Za-z0-9_-]+$/);
    expect(saved?.intakeApiKeyHash).toBe(hashIntakeKey(rotated.key));
    expect(saved?.intakeApiKeyHash).not.toContain(rotated.key);
    await expect(
      service.validateIntakeKey("tenant-1", rotated.key),
    ).resolves.toBe(true);
    await expect(
      service.validateIntakeKey("tenant-1", `${rotated.key}wrong`),
    ).resolves.toBe(false);
  });

  it("never returns stored hashes or legacy encrypted provider fields", async () => {
    Object.assign(saved!, {
      intakeApiKeyHash: "b".repeat(64),
      intakeApiKeyLast4: "1234",
      twilioAuthTokenEnc: "secret-twilio",
      sendgridApiKeyEnc: "secret-sendgrid",
      zapierApiKeyHash: "secret-zapier-hash",
    });

    const response = await service.getTenantSettings("tenant-1");
    expect(response.intake).toMatchObject({ configured: true, last4: "1234" });
    expect(JSON.stringify(response)).not.toContain("secret-");
    expect(response).not.toHaveProperty("intakeApiKeyHash");
  });

  it("rejects invalid zones and records explicit IANA-zone verification", async () => {
    await expect(
      service.updateTenantSettings("tenant-1", { timeZone: "Mars/Olympus" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateTenantSettings("tenant-1", {
        timeZone: "America/Los_Angeles",
      }),
    ).resolves.toMatchObject({ timeZone: "America/Los_Angeles" });
    expect(saved?.timeZoneVerifiedAt).toBeInstanceOf(Date);
    expect(onboarding.invalidateLaunchEvidence).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({ retestEndToEnd: true }),
    );
  });

  it("expires booking-link verification and resets it when the URL changes", async () => {
    saved!.bookingLink = "https://cal.example.com/first";
    const verified = await service.verifyBookingLink("tenant-1");
    expect(verified.bookingLinkStatus).toBe("verified");
    expect(saved?.bookingLinkVerificationStatus).toBe("verified");
    expect(saved?.bookingLinkVerificationExpiresAt?.getTime()).toBeGreaterThan(
      saved?.bookingLinkVerifiedAt?.getTime() || 0,
    );

    await service.updateTenantSettings("tenant-1", {
      bookingLink: "https://cal.example.com/second",
    });
    expect(saved).toMatchObject({
      bookingLinkVerificationStatus: "unverified",
      bookingLinkVerifiedAt: null,
      bookingLinkVerificationExpiresAt: null,
    });
    expect(onboarding.invalidateLaunchEvidence).toHaveBeenCalledWith(
      "tenant-1",
      expect.objectContaining({ retestEndToEnd: true }),
    );
  });
});
