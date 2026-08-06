import { RealtorComController } from "./realtor-com.controller";

describe("RealtorComController webhook compatibility", () => {
  it("routes real legacy webhook traffic through the unified ingestion pipeline", async () => {
    const realtor = { receiveLead: jest.fn() };
    const leadIngestion = {
      ingest: jest.fn().mockResolvedValue({
        acknowledged: true,
        status: "accepted",
        eventId: "event-1",
        leadId: "lead-1",
      }),
    };
    const controller = new RealtorComController(
      realtor as never,
      leadIngestion as never,
    );
    await expect(
      controller.receiveLead(
        "untrusted-path-tenant",
        { "x-api-key": "provider-key" },
        { leadId: "realtor-1", email: "lead@example.com" },
        { correlationId: "request-1", header: jest.fn() },
      ),
    ).resolves.toMatchObject({ status: "accepted" });
    expect(leadIngestion.ingest).toHaveBeenCalledWith({
      body: { leadId: "realtor-1", email: "lead@example.com" },
      headers: {
        "x-api-key": "provider-key",
        "x-lead-provider": "realtor",
      },
      correlationId: "request-1",
    });
    expect(realtor.receiveLead).not.toHaveBeenCalled();
  });

  it("preserves the existing provider connection-test handshake", async () => {
    const realtor = {
      receiveLead: jest.fn().mockResolvedValue({
        success: true,
        status: "connected",
      }),
    };
    const leadIngestion = { ingest: jest.fn() };
    const controller = new RealtorComController(
      realtor as never,
      leadIngestion as never,
    );
    await expect(
      controller.receiveLead(
        "tenant-1",
        { "x-api-key": "provider-key" },
        { test: true },
        { header: jest.fn() },
      ),
    ).resolves.toEqual({ success: true, status: "connected" });
    expect(realtor.receiveLead).toHaveBeenCalledWith(
      "tenant-1",
      { "x-api-key": "provider-key" },
      { test: true },
    );
    expect(leadIngestion.ingest).not.toHaveBeenCalled();
  });
});
