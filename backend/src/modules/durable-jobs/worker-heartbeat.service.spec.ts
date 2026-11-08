import { WorkerHeartbeatService } from './worker-heartbeat.service';

function heartbeatRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hb-1',
    workerKey: 'durable_job_worker',
    displayName: 'Durable job worker (5s poll)',
    expectedIntervalSeconds: 5,
    isCritical: true,
    heartbeatSource: 'direct',
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    lastCheckAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('WorkerHeartbeatService', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });
  function setup(rows: unknown[] = []) {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const dataSource = {
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return [];
      }),
    };
    const heartbeats = { find: jest.fn(async () => rows) };
    const service = new WorkerHeartbeatService(
      dataSource as any,
      heartbeats as any,
    );
    return { service, dataSource, heartbeats, queries };
  }

  it('records a success tick via upsert without throwing', async () => {
    const { service, queries } = setup();
    await service.recordTick('durable_job_worker');
    expect(queries.length).toBe(1);
    expect(queries[0].sql).toContain('ON CONFLICT (worker_key)');
    expect(queries[0].params?.[0]).toBe('durable_job_worker');
  });

  it('records a failure with a sanitized error and increments the counter', async () => {
    const { service, queries } = setup();
    await service.recordFailure('ai_worker', new Error('provider timeout'));
    expect(queries[0].sql).toContain('consecutive_failures + 1');
    expect(queries[0].params).toContain('provider timeout');
  });

  it('reports ok for a recently ticked worker', async () => {
    const { service } = setup([
      heartbeatRow({ lastSuccessAt: new Date(), consecutiveFailures: 0 }),
    ]);
    const snapshot = await service.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      workerKey: 'durable_job_worker',
      status: 'ok',
      critical: true,
    });
  });

  it('reports stale for a direct worker that stopped ticking', async () => {
    const { service } = setup([
      heartbeatRow({
        lastSuccessAt: new Date(Date.now() - 10 * 60_000),
        consecutiveFailures: 0,
      }),
    ]);
    const snapshot = await service.snapshot();
    expect(snapshot[0].status).toBe('stale');
  });

  it('reports failing after repeated failures', async () => {
    const { service } = setup([
      heartbeatRow({
        lastSuccessAt: new Date(),
        consecutiveFailures: 3,
        lastError: 'boom',
      }),
    ]);
    const snapshot = await service.snapshot();
    expect(snapshot[0]).toMatchObject({
      status: 'failing',
      consecutiveFailures: 3,
      lastError: 'boom',
    });
  });

  it('reports unknown for a never-ticked worker instead of false-stale', async () => {
    const { service } = setup([
      heartbeatRow({
        workerKey: 'ai_worker',
        displayName: 'AI conversation worker (3s poll)',
        expectedIntervalSeconds: 3,
        lastSuccessAt: null,
      }),
    ]);
    const snapshot = await service.snapshot();
    expect(snapshot[0].status).toBe('unknown');
  });

  it('seeds the full worker inventory idempotently', async () => {
    const { service, queries } = setup();
    await service.ensureSeeded();
    const keys = queries.map((q) => q.params?.[0]);
    expect(keys).toContain('durable_job_worker');
    expect(keys).toContain('ai_worker');
    expect(keys).toContain('message_sender');
    expect(keys).toContain('sequence_worker');
    expect(keys).toContain('billing_grace_monitor');
    expect(keys).toContain('handoff_escalation');
    expect(keys).toContain('operational_reminders');
    expect(keys).toContain('health_critical_scan');
    expect(keys).toContain('safety_quality_scan');
    expect(keys).toContain('tenant_provisioning_scan');
    expect(keys).toContain('durable_job_supervisor');
    expect(queries.every((q) => q.sql.includes('ON CONFLICT'))).toBe(true);
  });

  it('refreshDerived updates durable-job-sourced heartbeats from job activity', async () => {
    const { service, dataSource } = setup();
    (dataSource.query as jest.Mock).mockImplementation(
      async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM durable_jobs')) {
          return [{ last_activity: new Date().toISOString() }];
        }
        return [];
      },
    );
    await service.refreshDerived();
    const updates = (dataSource.query as jest.Mock).mock.calls.filter(
      ([sql]: [string]) => sql.includes('UPDATE worker_heartbeat'),
    );
    expect(updates.length).toBeGreaterThan(0);
  });

  it('reports intentionally paused calendar and provisioning work separately from stale workers', async () => {
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'true';
    const { service } = setup(['calendar_watch_renewals', 'tenant_provisioning_scan'].map(workerKey =>
      heartbeatRow({ workerKey, lastSuccessAt: new Date('2026-01-01T00:00:00Z') }),
    ));
    expect((await service.snapshot()).map(worker => worker.status)).toEqual(['paused', 'paused']);
  });

  it('does not hide repeated failures during a global automation pause', async () => {
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'true';
    const { service } = setup([heartbeatRow({
      workerKey: 'calendar_watch_renewals', consecutiveFailures: 3,
      lastSuccessAt: new Date('2026-01-01T00:00:00Z'),
    })]);
    expect((await service.snapshot())[0].status).toBe('failing');
  });

  it('requires fresh activity again when the automation pause is cleared', async () => {
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'false';
    const { service } = setup([heartbeatRow({
      workerKey: 'calendar_watch_renewals', lastSuccessAt: new Date('2026-01-01T00:00:00Z'),
    })]);
    expect((await service.snapshot())[0].status).toBe('stale');
  });

  it('detects a stopped sender scheduler even when the platform is paused', async () => {
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'true';
    const { service } = setup([heartbeatRow({
      workerKey: 'message_sender', lastSuccessAt: new Date(Date.now() - 10 * 60_000),
    })]);
    expect((await service.snapshot())[0].status).toBe('stale');
  });

  it.each(['message_sender', 'ai_worker', 'sequence_worker'])(
    'uses actual poller liveness for %s rather than domain-table activity', async (key) => {
      const { service, queries } = setup();
      await service.recordTick(key);
      expect(queries[0].params?.[4]).toBe('direct');
    },
  );
});
