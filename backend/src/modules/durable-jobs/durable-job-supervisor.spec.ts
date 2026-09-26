import { DurableJobSupervisorService } from './durable-job-supervisor.service';

function failedJob(taskType: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `job-${taskType}`,
    task_type: taskType,
    tenant_id: null,
    attempt_count: 12,
    max_attempts: 12,
    last_error: 'boom',
    updated_at: new Date(),
    ...overrides,
  };
}

function recentActivity(minutesAgo = 1) {
  return new Date(Date.now() - minutesAgo * 60_000);
}

describe('DurableJobSupervisorService', () => {
  const OLD_TICK = new Date(Date.now() - 5 * 60_000).toISOString();

  function setup(queryImpl: (sql: string, params?: unknown[]) => unknown) {
    const dataSource = {
      query: jest.fn(async (sql: string, params?: unknown[]) =>
        queryImpl(sql, params),
      ),
    };
    const jobs = {};
    const heartbeats = {
      refreshDerived: jest.fn().mockResolvedValue(undefined),
      recordTick: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      snapshot: jest.fn().mockResolvedValue([]),
    };
    const operationalEvents = {
      integrationFailed: jest.fn().mockResolvedValue(undefined),
      integrationRecovered: jest.fn().mockResolvedValue(undefined),
    };
    const supervisor = new DurableJobSupervisorService(
      dataSource as any,
      jobs as any,
      undefined,
      heartbeats as any,
      operationalEvents as any,
    );
    return { supervisor, dataSource, heartbeats, operationalEvents };
  }

  /** Healthy baseline: no failed rows, fresh cadences, fresh worker tick. */
  function healthyQuery(sql: string, params?: unknown[]): unknown {
    if (sql.includes("status = 'failed'")) return [];
    if (sql.includes('attempt_count >= $1')) return [];
    if (sql.includes('lease_expires_at < NOW()')) return [{ count: 0 }];
    if (sql.includes('task_type = ANY($1)')) {
      return [
        { total: '1', last_activity: recentActivity(), overdue: '0' },
      ];
    }
    if (sql.includes('FROM worker_heartbeat')) {
      return [{ last_success_at: new Date().toISOString() }];
    }
    return [];
  }

  it('alerts on failed durable jobs via OperationalEventsService', async () => {
    const { supervisor, operationalEvents } = setup((sql, params) => {
      if (sql.includes("status = 'failed'")) {
        return [failedJob('tenant.provision')];
      }
      return healthyQuery(sql, params);
    });

    const findings = await supervisor.runScan();

    expect(findings.some((f) => f.kind === 'failed_jobs' && f.alertable)).toBe(
      true,
    );
    expect(operationalEvents.integrationFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'DurableJobs',
        platformImpact: true,
      }),
    );
  });

  it('suppresses alerts for failed alert-pipeline jobs (loop protection)', async () => {
    const { supervisor, operationalEvents } = setup((sql, params) => {
      if (sql.includes("status = 'failed'")) {
        return [
          failedJob('notifications.email_retry'),
          failedJob('durable_jobs.supervisor_scan'),
        ];
      }
      return healthyQuery(sql, params);
    });

    const findings = await supervisor.runScan();

    expect(
      findings.every((f) => f.kind !== 'failed_jobs' || !f.alertable),
    ).toBe(true);
    expect(operationalEvents.integrationFailed).not.toHaveBeenCalled();
  });

  it('flags repeatedly failing jobs before they hit the failed graveyard', async () => {
    const { supervisor, operationalEvents } = setup((sql, params) => {
      if (sql.includes('attempt_count >= $1')) {
        return [
          failedJob('calendar.google.renew_watch', {
            attempt_count: 9,
            max_attempts: 12,
          }),
        ];
      }
      return healthyQuery(sql, params);
    });

    const findings = await supervisor.runScan();

    expect(
      findings.some((f) => f.kind === 'repeated_failures' && f.alertable),
    ).toBe(true);
    expect(operationalEvents.integrationFailed).toHaveBeenCalled();
  });

  it('flags jobs stuck in processing past their lease', async () => {
    const { supervisor } = setup((sql, params) => {
      if (sql.includes('lease_expires_at < NOW()')) return [{ count: 3 }];
      return healthyQuery(sql, params);
    });

    const findings = await supervisor.runScan();

    expect(
      findings.some(
        (f) =>
          f.kind === 'stalled_processing' &&
          (f.details as { stalled: number }).stalled === 3,
      ),
    ).toBe(true);
  });

  it('flags a critical recurring scan that stopped running', async () => {
    const { supervisor } = setup((sql, params) => {
      if (sql.includes('task_type = ANY($1)')) {
        const taskTypes = (params?.[0] as string[]) || [];
        const stale = taskTypes.includes('health.critical_scan');
        return [
          {
            total: '1',
            last_activity: stale ? recentActivity(30) : recentActivity(),
            overdue: '0',
          },
        ];
      }
      return healthyQuery(sql, params);
    });

    const findings = await supervisor.runScan();

    expect(
      findings.some(
        (f) =>
          f.kind === 'cadence_missed' &&
          f.severity === 'critical' &&
          f.summary.includes('health.critical_scan'),
      ),
    ).toBe(true);
  });

  it('flags scheduler inactivity when the 5s worker stops ticking', async () => {
    const { supervisor } = setup((sql, params) => {
      if (sql.includes('FROM worker_heartbeat')) {
        return [{ last_success_at: OLD_TICK }];
      }
      return healthyQuery(sql, params);
    });

    const findings = await supervisor.runScan();

    expect(
      findings.some(
        (f) => f.kind === 'scheduler_inactive' && f.severity === 'critical',
      ),
    ).toBe(true);
  });

  it('records recovery when a clean scan follows findings', async () => {
    const { supervisor, operationalEvents } = setup((sql, params) => {
      if (sql.includes("status = 'failed'")) {
        return [failedJob('tenant.provision')];
      }
      return healthyQuery(sql, params);
    });
    await supervisor.runScan();
    expect(operationalEvents.integrationFailed).toHaveBeenCalledTimes(1);

    // Second scan is clean: same supervisor, healthy query impl now.
    (supervisor as any).dataSource.query.mockImplementation(
      async (sql: string, params?: unknown[]) => healthyQuery(sql, params),
    );
    await supervisor.runScan();

    expect(operationalEvents.integrationRecovered).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'DurableJobs' }),
    );
  });

  it('caps alerts per hour to bound feedback loops', async () => {
    const { supervisor, operationalEvents, dataSource } = setup((sql, params) => {
      if (sql.includes("status = 'failed'")) {
        return [failedJob('tenant.provision')];
      }
      return healthyQuery(sql, params);
    });

    for (let i = 0; i < 10; i += 1) {
      // Each scan re-alerts only if the incident was closed; force it open to
      // exercise the hourly cap path.
      (supervisor as any).incidentOpen = false;
      await supervisor.runScan();
    }

    expect(
      operationalEvents.integrationFailed.mock.calls.length,
    ).toBeLessThanOrEqual(6);
    expect(dataSource.query).toHaveBeenCalled();
  });

  it('never schedules jobs to raise an alert', async () => {
    const dataSource = {
      query: jest.fn(async (sql: string, params?: unknown[]) =>
        healthyQuery(sql, params),
      ),
    };
    const durableJobs = { schedule: jest.fn(), register: jest.fn() };
    const heartbeats = {
      refreshDerived: jest.fn().mockResolvedValue(undefined),
      recordTick: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn().mockResolvedValue(undefined),
      snapshot: jest.fn().mockResolvedValue([]),
    };
    const operationalEvents = {
      integrationFailed: jest.fn().mockResolvedValue(undefined),
      integrationRecovered: jest.fn().mockResolvedValue(undefined),
    };
    const supervisor = new DurableJobSupervisorService(
      dataSource as any,
      {} as any,
      durableJobs as any,
      heartbeats as any,
      operationalEvents as any,
    );

    (dataSource.query as jest.Mock).mockImplementation(
      async (sql: string, params?: unknown[]) => {
        if (sql.includes("status = 'failed'")) {
          return [failedJob('tenant.provision')];
        }
        return healthyQuery(sql, params);
      },
    );
    await supervisor.runScan();

    expect(operationalEvents.integrationFailed).toHaveBeenCalledTimes(1);
    expect(durableJobs.schedule).not.toHaveBeenCalled();
  });
});
