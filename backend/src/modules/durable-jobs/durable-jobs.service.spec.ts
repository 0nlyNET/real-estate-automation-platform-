import { DurableJobsService } from './durable-jobs.service';

describe('DurableJobsService restart recovery', () => {
  it('claims and completes a PostgreSQL-persisted job from a fresh worker', async () => {
    const job: any = {
      id: 'job-1',
      taskType: 'provisioning.reconcile',
      tenantId: 'tenant-1',
      dedupeKey: 'provisioning:tenant-1',
      payload: {},
      status: 'scheduled',
      nextRunAt: new Date(Date.now() - 1_000),
      attemptCount: 0,
      maxAttempts: 4,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      completedAt: null,
    };
    const jobs = {
      save: jest.fn(async (value) => Object.assign(job, value)),
    };
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT * FROM durable_jobs')) {
          return job.status === 'scheduled' ? [{ id: job.id }] : [];
        }
        if (sql.includes('UPDATE durable_jobs')) {
          job.status = 'running';
          job.attemptCount += 1;
          return [];
        }
        return [];
      }),
      getRepository: jest.fn(() => ({
        findOne: jest.fn(async () => job),
      })),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const recoveredWorker = new DurableJobsService(
      dataSource as any,
      jobs as any,
    );
    const handler = jest.fn().mockResolvedValue(undefined);
    recoveredWorker.register('provisioning.reconcile', handler);

    await expect(recoveredWorker.runDue()).resolves.toBe(1);
    expect(handler).toHaveBeenCalledWith(job);
    expect(job.status).toBe('completed');
    expect(job.attemptCount).toBe(1);
    expect(job.completedAt).toBeInstanceOf(Date);
    expect(job.leaseOwner).toBeNull();
  });

  it('does not clear an active lease when the same durable job is scheduled again', async () => {
    const running: any = {
      id: 'job-running',
      dedupeKey: 'tenant.provision:tenant-1',
      status: 'running',
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      attemptCount: 2,
    };
    const repository = {
      findOne: jest.fn().mockResolvedValue(running),
      save: jest.fn(),
      create: jest.fn((value) => value),
    };
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn(() => repository),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const service = new DurableJobsService(
      dataSource as any,
      {} as any,
    );

    await expect(
      service.schedule({
        taskType: 'tenant.provision',
        tenantId: 'tenant-1',
        dedupeKey: 'tenant.provision:tenant-1',
      }),
    ).resolves.toBe(running);
    expect(repository.save).not.toHaveBeenCalled();
    expect(running).toMatchObject({
      status: 'running',
      leaseOwner: 'worker-1',
      attemptCount: 2,
    });
  });

  it('makes expired running leases claimable after a worker crash', async () => {
    const queries: string[] = [];
    const manager = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return sql.includes('SELECT * FROM durable_jobs')
          ? [{ id: 'expired-job' }]
          : [];
      }),
      getRepository: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue({
          id: 'expired-job',
          taskType: 'recover',
          status: 'running',
          attemptCount: 2,
          maxAttempts: 4,
        }),
      })),
    };
    const jobs = { save: jest.fn(async (value) => value) };
    const service = new DurableJobsService(
      { transaction: jest.fn(async (callback) => callback(manager)) } as any,
      jobs as any,
    );
    service.register('recover', jest.fn().mockResolvedValue(undefined));

    await expect(service.runDue(1)).resolves.toBe(1);
    expect(queries[0]).toContain("status = 'running'");
    expect(queries[0]).toContain('lease_expires_at < NOW()');
  });
});
