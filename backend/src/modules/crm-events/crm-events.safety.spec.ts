import { Repository } from "typeorm";
import { CrmEventsService } from "./crm-events.service";
import { IntegrationDeliveryEvent } from "./integration-delivery-event.entity";
import { TenantWebhookSubscription } from "./tenant-webhook-subscription.entity";
import { DurableJob } from "../durable-jobs/durable-job.entity";
import {
  DurableJobHandler,
  DurableJobCancellationHandler,
  DurableJobsService,
} from "../durable-jobs/durable-jobs.service";
import { OperationsService } from "../operations/operations.service";
import { EntitlementService } from "../entitlements/entitlement.service";

describe("webhook cancellation and tenant boundaries", () => {
  function fixture() {
    const delivery = Object.assign(new IntegrationDeliveryEvent(), {
      id: "delivery-1",
      tenantId: "tenant-1",
      status: "scheduled",
    });
    const deliveries = {
      findOne: jest.fn().mockResolvedValue(delivery),
      save: jest.fn(),
    };
    const operations = { createTask: jest.fn() };
    let handler!: DurableJobHandler;
    let cancel!: DurableJobCancellationHandler;
    const service = new CrmEventsService(
      {} as Repository<TenantWebhookSubscription>,
      deliveries as unknown as Repository<IntegrationDeliveryEvent>,
      {
        register: (
          _name: string,
          run: DurableJobHandler,
          onStale: DurableJobCancellationHandler,
        ) => {
          handler = run;
          cancel = onStale;
        },
      } as unknown as DurableJobsService,
      operations as unknown as OperationsService,
      undefined,
      { evaluate: jest.fn() } as unknown as EntitlementService,
    );
    service.onModuleInit();
    const job = Object.assign(new DurableJob(), {
      tenantId: "tenant-1",
      payload: { deliveryId: delivery.id },
    });
    return { handler, cancel, job, delivery, deliveries, operations };
  }

  it("marks a stale webhook failed and opens a tenant-scoped incident without sending", async () => {
    const { cancel, job, delivery, deliveries, operations } = fixture();
    await cancel(job, "Cancelled on resume: stale automation");
    expect(deliveries.findOne).toHaveBeenCalledWith({
      where: { id: delivery.id, tenantId: "tenant-1" },
    });
    expect(deliveries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        lastError: expect.stringContaining("stale"),
      }),
    );
    expect(operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        relatedEntityId: delivery.id,
      }),
    );
  });

  it("does not reverse a successful delivery during cancellation", async () => {
    const { cancel, job, delivery, deliveries, operations } = fixture();
    delivery.status = "delivered";
    await cancel(job, "stale");
    expect(deliveries.save).not.toHaveBeenCalled();
    expect(operations.createTask).not.toHaveBeenCalled();
  });

  it("rejects a delivery outside the job workspace before network access", async () => {
    const { handler, job, deliveries } = fixture();
    deliveries.findOne.mockResolvedValue(null);
    await expect(handler(job)).rejects.toThrow(
      "Webhook delivery not found in this workspace",
    );
    expect(deliveries.findOne).toHaveBeenCalledWith({
      where: { id: "delivery-1", tenantId: "tenant-1" },
    });
    expect(deliveries.save).not.toHaveBeenCalled();
  });
});
