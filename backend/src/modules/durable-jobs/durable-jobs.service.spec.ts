import { DurableJobsService } from './durable-jobs.service';

describe('DurableJobsService restart recovery', () => {
  const originalGlobalPause = process.env.GLOBAL_AUTOMATIONS_DISABLED;

  afterEach(() => {
    if (originalGlobalPause === undefined) {
      delete process.env.GLOBAL_AUTOMATIONS_DISABLED;
    } else {
      process.env.GLOBAL_AUTOMATIONS_DISABLED = originalGlobalPause;
    }
  });

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

  it('does not claim external automation while the global switch is paused', async () => {
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'true';
    const manager = {
      query: jest.fn(async (sql: string, _parameters?: unknown[]) =>
        sql.includes('SELECT * FROM durable_jobs') ? [] : [],
      ),
    };
    const service = new DurableJobsService(
      { transaction: jest.fn(async (callback) => callback(manager)) } as any,
      {} as any,
    );

    await expect(service.runDue()).resolves.toBe(0);
    expect(manager.query.mock.calls[0][0]).toContain('task_type LIKE');
    expect(manager.query.mock.calls[0][1]).toContain('appointment.%');
    expect(manager.query.mock.calls[0][1]).toContain('integration.webhook_%');
  });

  it('cancels a stale automation job on resume without invoking its handler', async () => {
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'false';
    const job: any = {
      id: 'stale-job',
      taskType: 'integration.webhook_delivery',
      status: 'scheduled',
      createdAt: new Date(Date.now() - 16 * 60_000),
      nextRunAt: new Date(Date.now() - 16 * 60_000),
      attemptCount: 0,
      maxAttempts: 4,
    };
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT * FROM durable_jobs')) {
          return job.status === 'scheduled' ? [{ id: job.id }] : [];
        }
        if (sql.includes('UPDATE durable_jobs')) job.status = 'running';
        return [];
      }),
      getRepository: jest.fn(() => ({ findOne: jest.fn(async () => job) })),
    };
    const jobs = { save: jest.fn(async (value) => value) };
    const service = new DurableJobsService(
      { transaction: jest.fn(async (callback) => callback(manager)) } as any,
      jobs as any,
    );
    const handler = jest.fn();
    service.register(job.taskType, handler);

    await expect(service.runDue()).resolves.toBe(1);
    expect(handler).not.toHaveBeenCalled();
    expect(job.status).toBe('cancelled');
    expect(job.lastError).toContain('Cancelled on resume');
    expect(job.completedAt).toBeInstanceOf(Date);
  });

  it('runs exempt operational safety work during a global pause', async () => {
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'true';
    const job: any = {
      id: 'safety-job', taskType: 'safety.quality_scan', status: 'scheduled',
      nextRunAt: new Date(), attemptCount: 0, maxAttempts: 2,
    };
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT *')) return job.status === 'scheduled' ? [{ id: job.id }] : [];
        job.status = 'running'; return [];
      }),
      getRepository: jest.fn(() => ({ findOne: jest.fn(async () => job) })),
    };
    const jobs = { save: jest.fn(async (value) => value) };
    const service = new DurableJobsService(
      { transaction: jest.fn(async (callback) => callback(manager)) } as any,
      jobs as any,
    );
    const handler = jest.fn();
    service.register(job.taskType, handler);

    await expect(service.runDue()).resolves.toBe(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(job.status).toBe('completed');
  });

  it('re-evaluates current resume work but claims no more than five jobs per poll', async () => {
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'false';
    const jobsList = Array.from({ length: 7 }, (_, index) => ({
      id: `job-${index}`, taskType: 'appointment.post_commit', status: 'scheduled',
      nextRunAt: new Date(Date.now() - 14 * 60_000), attemptCount: 0, maxAttempts: 2,
    })) as any[];
    const manager = {
      query: jest.fn(async (sql: string, parameters?: unknown[]) => {
        if (sql.includes('SELECT *')) {
          const next = jobsList.find((job) => job.status === 'scheduled');
          return next ? [{ id: next.id }] : [];
        }
        const job = jobsList.find((item) => item.id === parameters?.[0]);
        if (job) job.status = 'running';
        return [];
      }),
      getRepository: jest.fn(() => ({
        findOne: jest.fn(async ({ where }: any) => jobsList.find((job) => job.id === where.id)),
      })),
    };
    const repository = { save: jest.fn(async (value) => value) };
    const service = new DurableJobsService(
      { transaction: jest.fn(async (callback) => callback(manager)) } as any,
      repository as any,
    );
    const handler = jest.fn(async (job) => {
      // Represents the handler's current-state/tenant re-evaluation boundary.
      expect(job.status).toBe('running');
    });
    service.register('appointment.post_commit', handler);

    await expect(service.runDue(20)).resolves.toBe(5);
    expect(handler).toHaveBeenCalledTimes(5);
    expect(jobsList.filter((job) => job.status === 'scheduled')).toHaveLength(2);
  });

  it('covers ON -> enqueue -> PAUSE -> enqueue/age -> RESUME without stale replay or duplicates', async () => {
    const rows: any[] = [];
    const repository = {
      create: jest.fn((value) => ({ id: `job-${rows.length + 1}`, createdAt: new Date(), ...value })),
      save: jest.fn(async (value) => {
        if (!rows.includes(value)) rows.push(value);
        return value;
      }),
      findOne: jest.fn(async ({ where }: any) =>
        where.id
          ? rows.find((row) => row.id === where.id)
          : rows.find((row) => row.dedupeKey === where.dedupeKey),
      ),
    };
    const manager = {
      query: jest.fn(async (sql: string, parameters?: unknown[]) => {
        if (sql.includes('SELECT * FROM durable_jobs')) {
          const paused = process.env.GLOBAL_AUTOMATIONS_DISABLED === 'true';
          const next = rows.find((row) => row.status === 'scheduled' && (!paused || row.taskType === 'safety.quality_scan'));
          return next ? [{ id: next.id }] : [];
        }
        if (sql.includes('UPDATE durable_jobs')) {
          const row = rows.find((item) => item.id === parameters?.[0]);
          row.status = 'running'; row.attemptCount += 1;
        }
        return [];
      }),
      getRepository: jest.fn(() => repository),
    };
    const service = new DurableJobsService(
      { transaction: jest.fn(async (callback) => callback(manager)) } as any,
      repository as any,
    );
    const external = jest.fn();
    service.register('integration.webhook_delivery', external);

    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'false';
    await service.schedule({ taskType: 'integration.webhook_delivery', tenantId: 'tenant-a', dedupeKey: 'event:1' });
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'true';
    const duplicate = await service.schedule({ taskType: 'integration.webhook_delivery', tenantId: 'tenant-a', dedupeKey: 'event:1' });
    await service.schedule({ taskType: 'integration.webhook_delivery', tenantId: 'tenant-b', dedupeKey: 'event:2' });
    rows.forEach((row) => { row.nextRunAt = new Date(Date.now() - 16 * 60_000); });
    await expect(service.runDue()).resolves.toBe(0);
    expect(external).not.toHaveBeenCalled();

    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'false';
    await expect(service.runDue(20)).resolves.toBe(2);
    expect(external).not.toHaveBeenCalled();
    expect(duplicate).toBe(rows[0]);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'cancelled')).toBe(true);
    expect(rows.every((row) => row.lastError.includes('Cancelled on resume'))).toBe(true);
  });
});
