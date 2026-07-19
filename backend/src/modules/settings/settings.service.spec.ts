import { SettingsService, hashIntakeKey } from "./settings.service";
import { TenantSettings } from "./tenant-settings.entity";

describe("SettingsService intake keys", () => {
  let saved: TenantSettings | null;
  let service: SettingsService;

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

    service = new SettingsService(
      tenantSettingsRepo as any,
      { findOne: jest.fn() } as any,
      { findOne: jest.fn(), create: jest.fn(), save: jest.fn() } as any,
      { assertAllowed: jest.fn() } as any,
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
});
