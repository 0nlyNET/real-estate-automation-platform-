import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { buildDatabaseOptions } from '../../database/database-options';
import { OperatorTestMessagingSchema1790985600000 } from '../../database/migrations/202610030002-operator-test-messaging-schema';
import { OperatorTestAuthorization } from './operator-test-authorization.entity';
import { OperatorTestGrantUsage } from './operator-test-grant-usage.entity';
import { OperatorTestGuard } from './operator-test.guard';

const testUrl = process.env.TEST_POSTGRES_URL;
const postgres = testUrl ? describe : describe.skip;

postgres('registered operator-test migrations and concurrent quotas (PostgreSQL)', () => {
  const databaseName = `rta_operator_${randomUUID().replace(/-/g, '')}`;
  let admin: Client;
  let source: DataSource;
  let guard: OperatorTestGuard;
  let url: string;
  const finalMigration = OperatorTestMessagingSchema1790985600000;
  jest.setTimeout(120_000);

  beforeAll(async () => {
    const parsed = new URL(testUrl!);
    // These tests create/drop only their own disposable database. Never run
    // migration or cleanup operations against a configured service database.
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
      throw new Error('Operator PostgreSQL tests require a local disposable database server');
    }
    admin = new Client({ connectionString: testUrl }); await admin.connect();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    parsed.pathname = `/${databaseName}`; url = parsed.toString();
    source = new DataSource({ ...(buildDatabaseOptions(url) as PostgresConnectionOptions), type: 'postgres', synchronize: false, migrationsRun: false, ssl: false });
    await source.initialize();
  });
  afterAll(async () => {
    if (source?.isInitialized) await source.destroy();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  });

  it('runs the real registered migration chain on a fresh database', async () => {
    expect(source.migrations.at(-1)).toBeInstanceOf(finalMigration);
    await source.runMigrations();
    await expect(source.query('SELECT is_operator_test, operator_test_grant_id FROM messages LIMIT 1')).resolves.toEqual([]);
    await expect(source.query('SELECT id FROM operator_test_authorizations LIMIT 1')).resolves.toEqual([]);
    await expect(source.query('SELECT id FROM operator_test_grant_usages LIMIT 1')).resolves.toEqual([]);
    await expect(source.runMigrations()).resolves.toEqual([]);
  });

  it('upgrades the previous schema through application registration', async () => {
    await source.undoLastMigration();
    const columns = await source.query(`SELECT column_name FROM information_schema.columns
      WHERE table_name = 'messages' AND column_name = 'is_operator_test'`);
    expect(columns).toEqual([]);
    await source.runMigrations();
    await expect(source.query('SELECT is_operator_test, operator_test_grant_id FROM messages LIMIT 1')).resolves.toEqual([]);
    guard = new OperatorTestGuard(source, source.getRepository(OperatorTestAuthorization), source.getRepository(OperatorTestGrantUsage));
  });

  async function grant(limits: { dailyLimit: number; totalLimit: number }) {
    return source.getRepository(OperatorTestAuthorization).save({
      tenantId: randomUUID(), recipientAllowlist: ['owned@example.test'], channel: 'email',
      expiresAt: new Date(Date.now() + 60_000), createdBy: randomUUID(), ...limits,
    });
  }
  async function reserve(auth: OperatorTestAuthorization, messageId = randomUUID(), recipientEmail = 'owned@example.test') {
    return guard.reserveQuota({ tenantId: auth.tenantId, recipientEmail, channel: 'email', messageId, grantId: auth.id });
  }

  it('serializes distinct workers at the daily limit and preserves retry identity', async () => {
    const auth = await grant({ dailyLimit: 10, totalLimit: 50 });
    const ids = Array.from({ length: 18 }, () => randomUUID());
    const results = await Promise.all(ids.map(id => reserve(auth, id)));
    expect(results.filter(Boolean)).toHaveLength(10);
    const acceptedId = ids[results.findIndex(Boolean)];
    await expect(reserve(auth, acceptedId)).resolves.toMatchObject({ id: auth.id });
    expect(await source.getRepository(OperatorTestGrantUsage).count({ where: { grantId: auth.id } })).toBe(10);
    await expect(reserve(auth, acceptedId, 'stranger@example.test')).resolves.toBeNull();
    const replacement = await grant({ dailyLimit: 10, totalLimit: 50 });
    replacement.tenantId = auth.tenantId;
    await source.getRepository(OperatorTestAuthorization).save(replacement);
    await expect(reserve(replacement, acceptedId)).resolves.toBeNull();
  });

  it('enforces the total quota across concurrent messages', async () => {
    const auth = await grant({ dailyLimit: 10, totalLimit: 5 });
    const results = await Promise.all(Array.from({ length: 12 }, () => reserve(auth)));
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it('revalidates revoked and expired grants even for reserved messages', async () => {
    const auth = await grant({ dailyLimit: 10, totalLimit: 50 });
    const id = randomUUID(); await reserve(auth, id);
    await guard.revoke(auth.id, randomUUID());
    await expect(reserve(auth, id)).resolves.toBeNull();
    const expired = await grant({ dailyLimit: 10, totalLimit: 50 });
    await source.getRepository(OperatorTestAuthorization).update(expired.id, { expiresAt: new Date(Date.now() - 1000) });
    await expect(reserve(expired)).resolves.toBeNull();
  });
});
