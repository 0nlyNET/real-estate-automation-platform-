import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { LeadIngestionController } from "./lead-ingestion.controller";
import { LeadIngestionService } from "./lead-ingestion.service";

describe("POST /api/v1/ingest/lead", () => {
  let app: INestApplication;
  const ingest = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LeadIngestionController],
      providers: [{ provide: LeadIngestionService, useValue: { ingest } }],
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns HTTP 200 when an authenticated provider event fails validation", async () => {
    ingest.mockResolvedValueOnce({
      acknowledged: true,
      status: "rejected_validation",
      eventId: "event-1",
      leadId: null,
      validationError: "No valid contact channel",
    });
    const response = await fetch(`${await app.getUrl()}/api/v1/ingest/lead`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ingestion-key": "provider-key",
        "x-lead-provider": "zillow",
      },
      body: JSON.stringify({ providerLeadId: "zillow-invalid" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      acknowledged: true,
      status: "rejected_validation",
    });
  });
});
