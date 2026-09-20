import { DataSource, Repository } from "typeorm";
import { DurableJob } from "./durable-job.entity";
import { DurableJobsService } from "./durable-jobs.service";
import { OperationsService } from "../operations/operations.service";

describe("durable automation cancellation safety", () => {
  const originalPause = process.env.GLOBAL_AUTOMATIONS_DISABLED;
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.GLOBAL_AUTOMATIONS_DISABLED = "false";
  });
  afterEach(() => {
    jest.useRealTimers();
    if (originalPause === undefined)
      delete process.env.GLOBAL_AUTOMATIONS_DISABLED;
    else process.env.GLOBAL_AUTOMATIONS_DISABLED = originalPause;
  });

  function fixture(taskType = "integration.webhook_delivery") {
    const due = new Date(Date.now() - 60 * 60_000);
    const job = Object.assign(new DurableJob(), {
      id: "job-1",
      tenantId: "tenant-1",
      payload: {},
      taskType,
      nextRunAt: due,
      scheduledRunAt: due,
      status: "scheduled",
      attemptCount: 0,
      maxAttempts: 4,
    });
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT *"))
          return job.status === "scheduled" &&
            job.nextRunAt.getTime() <= Date.now()
            ? [{ id: job.id }]
            : [];
        job.status = "running";
        job.attemptCount += 1;
        return [];
      }),
      getRepository: () => ({ findOne: async () => job }),
    };
    const jobs = { save: jest.fn(async (value: DurableJob) => value) };
    const operations = { createTask: jest.fn() };
    const service = new DurableJobsService(
      {
        transaction: async (
          callback: (value: typeof manager) => Promise<unknown>,
        ) => callback(manager),
      } as unknown as DataSource,
      jobs as unknown as Repository<DurableJob>,
      operations as unknown as OperationsService,
    );
    return { service, job, manager, operations };
  }

  it("retries failed domain cleanup without making the external action fresh", async () => {
    const { service, job, operations } = fixture();
    const originalDue = job.scheduledRunAt;
    const send = jest.fn();
    const cleanup = jest
      .fn()
      .mockRejectedValueOnce(new Error("database temporarily unavailable"))
      .mockResolvedValue(undefined);
    service.register(job.taskType, send, cleanup);
    await service.runDue(1);
    expect(job.status).toBe("scheduled");
    expect(job.scheduledRunAt).toBe(originalDue);
    jest.setSystemTime(new Date(Date.now() + 61_000));
    await service.runDue(1);
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(send).not.toHaveBeenCalled();
    expect(job.status).toBe("cancelled");
    expect(operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        relatedEntityId: job.id,
      }),
    );
  });

  it.each([
    "calendar.google.renew_watch",
    "calendar.microsoft.renew_subscription",
    "calendar.calendly.reconcile_all",
    "appointment.reconcile_calendar",
    "tenant.provisioning_scan",
    "twilio.a2p_reconcile",
  ])(
    "keeps current-state maintenance %s alive after downtime",
    async (taskType) => {
      const { service, job } = fixture(taskType);
      const nextRunAt = new Date(Date.now() + 60_000);
      const reconcile = jest.fn().mockResolvedValue({ nextRunAt });
      service.register(taskType, reconcile);
      await service.runDue(1);
      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(job).toMatchObject({
        status: "scheduled",
        nextRunAt,
        scheduledRunAt: nextRunAt,
      });
    },
  );

  it("honors a pause raised after claiming a job", async () => {
    const { service, job, manager } = fixture();
    manager.getRepository = () => ({
      findOne: async () => {
        process.env.GLOBAL_AUTOMATIONS_DISABLED = "true";
        return job;
      },
    });
    const send = jest.fn();
    const cleanup = jest.fn();
    service.register(job.taskType, send, cleanup);
    await service.runDue(1);
    expect(send).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(job).toMatchObject({
      status: "scheduled",
      attemptCount: 0,
      leaseOwner: null,
    });
  });
});
