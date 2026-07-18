import { Credential } from "../settings/credential.entity";
import { IntegrationsService } from "./integrations.service";

describe("IntegrationsService connection states", () => {
  const originalKey = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  let rows: Credential[];
  let service: IntegrationsService;

  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      "base64",
    );
    rows = [];
    const repo = {
      findOne: jest.fn(async ({ where }: any) => {
        return (
          rows.find(
            (row) =>
              row.provider === where.provider &&
              row.tenant.id === where.tenant.id,
          ) || null
        );
      }),
      find: jest.fn(async ({ where }: any) =>
        rows.filter((row) => row.tenant.id === where.tenant.id),
      ),
      create: jest.fn((value: Partial<Credential>) =>
        Object.assign(new Credential(), value, {
          id: `credential-${rows.length + 1}`,
        }),
      ),
      save: jest.fn(async (value: Credential) => {
        const index = rows.findIndex((row) => row.id === value.id);
        if (index >= 0) rows[index] = value;
        else rows.push(value);
        return value;
      }),
    };
    service = new IntegrationsService(repo as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.INTEGRATIONS_ENCRYPTION_KEY = originalKey;
  });

  it("requires a successful Twilio test before reporting connected", async () => {
    await service.connectTwilio("tenant-1", {
      accountSid: "AC123",
      authToken: "token",
      fromNumber: "+15555550100",
    });

    await expect(service.list("tenant-1")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "twilio",
          connected: false,
          status: "configured",
        }),
      ]),
    );

    jest.spyOn(global, "fetch").mockResolvedValue({ ok: true } as Response);
    await expect(service.testTwilio("tenant-1", {})).resolves.toEqual({
      ok: true,
    });

    await expect(service.list("tenant-1")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "twilio",
          connected: true,
          status: "connected",
        }),
      ]),
    );
  });
});
