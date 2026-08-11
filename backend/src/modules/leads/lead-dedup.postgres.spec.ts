import { randomUUID } from 'crypto';

const databaseUrl = String(process.env.TEST_POSTGRES_URL || '').trim();
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('real PostgreSQL lead intake contention', () => {
  const schema = `lead_dedup_${randomUUID().replace(/-/g, '')}`;
  let pool: any;

  beforeAll(async () => {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`
      CREATE TABLE "${schema}".leads (
        id uuid PRIMARY KEY,
        tenant_id text NOT NULL,
        email text,
        phone text
      )
    `);
    await pool.query(`
      CREATE UNIQUE INDEX leads_tenant_email
      ON "${schema}".leads (tenant_id, email) WHERE email IS NOT NULL
    `);
    await pool.query(`
      CREATE UNIQUE INDEX leads_tenant_phone
      ON "${schema}".leads (tenant_id, phone) WHERE phone IS NOT NULL
    `);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  });

  it('returns one lead when two independent connections ingest the same contact', async () => {
    const tenantId = 'tenant-a';
    const email = 'same@example.com';
    const phone = '15550000001';
    const intake = async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locks = [
          `lead-dedup:${tenantId}:email:${email}`,
          `lead-dedup:${tenantId}:phone:${phone}`,
        ].sort();
        for (const lock of locks) {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lock]);
        }
        const existing = await client.query(
          `SELECT id FROM "${schema}".leads
           WHERE tenant_id = $1 AND (email = $2 OR phone = $3)`,
          [tenantId, email, phone],
        );
        const id = existing.rows[0]?.id || randomUUID();
        if (!existing.rows[0]) {
          await client.query(
            `INSERT INTO "${schema}".leads (id, tenant_id, email, phone)
             VALUES ($1, $2, $3, $4)`,
            [id, tenantId, email, phone],
          );
        }
        await client.query('COMMIT');
        return id;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };

    const [first, second] = await Promise.all([intake(), intake()]);
    expect(first).toBe(second);
    const count = await pool.query(
      `SELECT COUNT(*)::int AS count FROM "${schema}".leads`,
    );
    expect(count.rows[0].count).toBe(1);
  });
});
