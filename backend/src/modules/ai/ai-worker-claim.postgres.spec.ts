import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { AiConversationService } from './ai-conversation.service';

const testUrl = process.env.TEST_POSTGRES_URL;
const postgres = testUrl ? describe : describe.skip;

postgres('paused AI worker claim query (PostgreSQL)', () => {
  const databaseName = `rta_ai_claim_${randomUUID().replace(/-/g, '')}`;
  let admin: Client;
  let source: DataSource;
  let created = false;
  jest.setTimeout(120_000);

  beforeAll(async () => {
    const parsed = new URL(testUrl!);
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      throw new Error('AI claim tests require a local disposable PostgreSQL server');
    }
    admin = new Client({ connectionString: testUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    parsed.pathname = `/${databaseName}`;
    source = new DataSource({
      type: 'postgres', url: parsed.toString(), ssl: false,
      synchronize: false, migrationsRun: false,
    });
    await source.initialize();
    await source.query(`CREATE TABLE operator_test_authorizations (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
      is_revoked boolean NOT NULL, expires_at timestamptz NOT NULL
    )`);
    await source.query(`CREATE TABLE ai_runs (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
      status varchar NOT NULL DEFAULT 'queued',
      attempt_count integer NOT NULL DEFAULT 0,
      prompt_metadata jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      locked_at timestamptz, locked_by varchar
    )`);
  });

  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (admin) {
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await source.query('TRUNCATE ai_runs, operator_test_authorizations');
  });

  function worker(workerId = 'ai-claim-regression') {
    return Object.assign(Object.create(AiConversationService.prototype), {
      dataSource: source, workerId,
      logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
      dispatchClaimedRuns: jest.fn(),
    }) as AiConversationService;
  }

  async function grant(tenantId: string, revoked = false, expired = false) {
    const id = randomUUID();
    await source.query(
      'INSERT INTO operator_test_authorizations VALUES ($1, $2, $3, $4)',
      [id, tenantId, revoked, new Date(Date.now() + (expired ? -60_000 : 60_000))],
    );
    return id;
  }

  async function run(tenantId: string, grantId?: string, attempts = 0) {
    const id = randomUUID();
    await source.query(
      `INSERT INTO ai_runs (id, tenant_id, prompt_metadata, attempt_count)
       VALUES ($1, $2, $3, $4)`,
      [id, tenantId, JSON.stringify(grantId ? { operatorTestGrantId: grantId } : {}), attempts],
    );
    return id;
  }

  it('polls an empty paused queue without an untyped unused SQL parameter', async () => {
    const previous = process.env.GLOBAL_AUTOMATIONS_DISABLED;
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'true';
    try {
      await expect(worker().processPendingRuns(10)).resolves.toEqual({
        claimed: 0, recovered: 0, paused: true,
      });
    } finally {
      if (previous === undefined) delete process.env.GLOBAL_AUTOMATIONS_DISABLED;
      else process.env.GLOBAL_AUTOMATIONS_DISABLED = previous;
    }
  });

  it('claims only matching valid grants and leaves other or malformed runs queued', async () => {
    const tenantId = randomUUID();
    const ownGrant = await grant(tenantId);
    const eligible = await run(tenantId, ownGrant);
    const blocked = [
      await run(tenantId),
      await run(tenantId, randomUUID()),
      await run(tenantId, 'not-a-uuid'),
      await run(tenantId, '-'.repeat(36)),
      await run(tenantId, await grant(tenantId, true)),
      await run(tenantId, await grant(tenantId, false, true)),
      await run(tenantId, await grant(randomUUID())),
      await run(tenantId, ownGrant, 3),
    ];
    const service = worker();
    await expect((service as any).claimOperatorTestRuns(10)).resolves.toEqual([eligible]);
    expect(await source.query('SELECT status, attempt_count, locked_by FROM ai_runs WHERE id = $1', [eligible]))
      .toEqual([{ status: 'processing', attempt_count: 1, locked_by: 'ai-claim-regression' }]);
    const untouched = await source.query(
      'SELECT id, status, attempt_count, locked_by FROM ai_runs WHERE id = ANY($1::uuid[])', [blocked],
    );
    expect(untouched).toHaveLength(blocked.length);
    expect(untouched.every((row: any) => row.status === 'queued' && row.locked_by === null)).toBe(true);
    await expect((service as any).claimOperatorTestRuns(10)).resolves.toEqual([]);
  });

  it('keeps concurrent claims disjoint and honors each worker limit', async () => {
    const tenantId = randomUUID();
    const grantId = await grant(tenantId);
    const ids = await Promise.all(Array.from({ length: 4 }, () => run(tenantId, grantId)));
    const [first, second] = await Promise.all([
      (worker('first') as any).claimOperatorTestRuns(2),
      (worker('second') as any).claimOperatorTestRuns(2),
    ]);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(new Set([...first, ...second])).toEqual(new Set(ids));
    const attempts = await source.query('SELECT attempt_count FROM ai_runs');
    expect(attempts.every((row: any) => row.attempt_count === 1)).toBe(true);
  });
});
