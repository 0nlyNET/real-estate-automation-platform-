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
    service = new IntegrationsService(repo as any, {
      createTask: jest.fn(),
    } as any);
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

  it("queues an operator task when a provider test fails", async () => {
    const createTask = jest.fn();
    (service as any).operations = { createTask };
    await service.connectTwilio("tenant-1", {
      accountSid: "AC123",
      authToken: "secret-token",
      fromNumber: "+15555550100",
    });
    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue("Unauthorized"),
    } as any);

    await expect(service.testTwilio("tenant-1", {})).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("Twilio test failed"),
    });
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        category: "integration_test_failure",
        priority: "high",
        dedupeOpen: true,
      }),
    );
    expect(JSON.stringify(createTask.mock.calls)).not.toContain("secret-token");
  });

  it("does not enumerate another tenant's provider configuration", async () => {
    await service.connectSendGrid("tenant-b", {
      apiKey: "SG.tenant-b-secret",
      fromEmail: "b@example.test",
    });
    await service.connectTwilio("tenant-a", {
      accountSid: "ACtenantA",
      authToken: "tenant-a-secret",
      fromNumber: "+15555550100",
    });

    const tenantA = await service.list("tenant-a");
    expect(tenantA.find((item) => item.provider === "twilio")).toMatchObject({
      status: "configured",
      display: { fromNumber: "+15555550100" },
    });
    expect(tenantA.find((item) => item.provider === "sendgrid")).toMatchObject({
      status: "disconnected",
      display: { fromEmail: null, apiKey: null },
    });
    expect(JSON.stringify(tenantA)).not.toContain("tenant-b-secret");
    expect(JSON.stringify(tenantA)).not.toContain("b@example.test");
  });
});
