import { randomUUID } from 'crypto';
import { LeadsService } from './leads.service';

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

  it.each(['PAUSED', 'SUSPENDED', 'ACTIVE'])('persists %s intake in PostgreSQL while outbound stays blocked', async (lifecycleStatus) => {
    const tenantId = `retained-${lifecycleStatus}`;
    const email = `retained-${lifecycleStatus.toLowerCase()}@example.invalid`;
    const repo = {
      findOne: jest.fn(async () => null),
      create: (row: any) => ({ ...row, id: randomUUID() }),
      save: async (row: any) => {
        await pool.query(`INSERT INTO "${schema}".leads (id, tenant_id, email, phone) VALUES ($1,$2,$3,$4)`,
          [row.id, row.tenantId, row.email, row.phone || null]);
        return row;
      },
    };
    const events = { create: (row: any) => row, save: jest.fn(async (row: any) => row) };
    const messaging = { queueInstantResponses: jest.fn() };
    const sequences = { startForLead: jest.fn() };
    const ai = { acceptLead: jest.fn() };
    const compliance = { recordLeadConsent: jest.fn() };
    const service = new LeadsService(repo as any, events as any, events as any,
      {} as any, { findOne: jest.fn(async () => null) } as any, {} as any,
      { findById: jest.fn(async () => ({ id: tenantId, lifecycleStatus, serviceActivatedAt: new Date() })) } as any,
      messaging as any, sequences as any, { routeLead: jest.fn(async () => null) } as any,
      compliance as any, undefined,
      { reserveUsage: jest.fn(async () => ({ ok: false, code: 'LIMIT_LEADS' })) } as any,
      undefined, undefined, ai as any);
    const saved = await service.intake(tenantId, { fullName: 'Synthetic retention check', email });
    const stored = await pool.query(`SELECT tenant_id, email, phone FROM "${schema}".leads WHERE id=$1`, [saved.id]);
    expect(stored.rows).toEqual([{ tenant_id: tenantId, email, phone: null }]);
    expect(events.save).toHaveBeenCalledWith(expect.objectContaining({eventType: 'intake_retained_automation_blocked'}));
    expect(ai.acceptLead).not.toHaveBeenCalled();
    expect(messaging.queueInstantResponses).not.toHaveBeenCalled();
    expect(sequences.startForLead).not.toHaveBeenCalled();
    expect(compliance.recordLeadConsent).toHaveBeenCalledWith(tenantId, saved.id, undefined);
  });

});
