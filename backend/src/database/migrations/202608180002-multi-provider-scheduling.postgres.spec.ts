import { randomUUID } from 'crypto';
import { QueryRunner } from 'typeorm';
import { MultiProviderScheduling1787011200002 } from './202608180002-multi-provider-scheduling';

describe('MultiProviderScheduling1787011200002 SQL safety', () => {
  it('compares the UUID connection tenant as text during the legacy settings backfill', async () => {
    const queries: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        return [];
      }),
    } as unknown as QueryRunner;

    await new MultiProviderScheduling1787011200002().up(queryRunner);

    const backfill = queries.find(
      (query) =>
        query.includes('UPDATE "tenant_settings"') &&
        query.includes('active_booking_provider'),
    );
    expect(backfill).toContain('EXISTS');
    expect(backfill).toContain(
      '"connection"."tenant_id"::text = "settings"."tenant_id"',
    );
    expect(backfill).not.toMatch(/"tenant_settings"\."tenant_id"::uuid/i);
  });
});

const databaseUrl = String(process.env.TEST_POSTGRES_URL || '').trim();
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres(
  'MultiProviderScheduling1787011200002 on real PostgreSQL',
  () => {
    const schema = `multi_provider_${randomUUID().replace(/-/g, '')}`;
    let pool: any;
    let client: any;

    beforeAll(async () => {
      const { Pool } = require('pg');
      pool = new Pool({ connectionString: databaseUrl, max: 1 });
      client = await pool.connect();
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      await client.query(`
        CREATE TABLE tenants (
          id uuid PRIMARY KEY
        );
        CREATE TABLE tenant_settings (
          id uuid PRIMARY KEY,
          tenant_id varchar UNIQUE
        );
        CREATE TABLE calendar_connections (
          id uuid PRIMARY KEY,
          tenant_id uuid NOT NULL,
          provider varchar(30) NOT NULL DEFAULT 'google',
          status varchar(30) NOT NULL DEFAULT 'configured',
          selected_calendar_id text,
          last_tested_at timestamptz
        );
        CREATE TABLE calendar_oauth_states (
          id uuid PRIMARY KEY
        );
        CREATE TABLE appointments (
          id uuid PRIMARY KEY,
          tenant_id uuid NOT NULL,
          external_event_id varchar(255),
          external_provider varchar(30),
          calendar_source varchar(80),
          sync_status varchar(30) NOT NULL DEFAULT 'not_synced'
        );
      `);

      const tenantId = randomUUID();
      await client.query(
        `INSERT INTO tenants (id) VALUES ($1)`,
        [tenantId],
      );
      await client.query(
        `INSERT INTO tenant_settings (id, tenant_id)
         VALUES ($1, $2), ($3, 'legacy-tenant-key')`,
        [randomUUID(), tenantId, randomUUID()],
      );
      await client.query(
        `INSERT INTO calendar_connections
           (id, tenant_id, provider, status, selected_calendar_id, last_tested_at)
         VALUES ($1, $2, 'google', 'connected', 'primary', now())`,
        [randomUUID(), tenantId],
      );
    });

    afterAll(async () => {
      if (!pool) return;
      if (client) client.release();
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    });

    it('backfills varchar tenant settings without UUID operator errors and rolls back atomically', async () => {
      const queryRunner = {
        query: async (sql: string, parameters?: unknown[]) => {
          const result = await client.query(sql, parameters);
          return result.rows;
        },
      } as unknown as QueryRunner;
      const migration = new MultiProviderScheduling1787011200002();

      await client.query('BEGIN');
      await migration.up(queryRunner);

      const insideTransaction = await client.query(
        `SELECT tenant_id, active_booking_provider
         FROM tenant_settings`,
      );
      expect(
        insideTransaction.rows.find(
          (row: { tenant_id: string }) => row.tenant_id === 'legacy-tenant-key',
        ),
      ).toEqual({
        tenant_id: 'legacy-tenant-key',
        active_booking_provider: null,
      });
      expect(
        insideTransaction.rows.find(
          (row: { tenant_id: string }) => row.tenant_id !== 'legacy-tenant-key',
        ),
      ).toEqual(
        expect.objectContaining({ active_booking_provider: 'google_calendar' }),
      );

      await client.query('ROLLBACK');

      const columnAfterRollback = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = $1
           AND table_name = 'tenant_settings'
           AND column_name = 'active_booking_provider'`,
        [schema],
      );
      const tableAfterRollback = await client.query(
        `SELECT to_regclass($1) AS name`,
        [`${schema}.booking_webhook_receipts`],
      );
      expect(columnAfterRollback.rowCount).toBe(0);
      expect(tableAfterRollback.rows[0].name).toBeNull();

      await client.query('BEGIN');
      await migration.up(queryRunner);
      await client.query('COMMIT');

      const committed = await client.query(
        `SELECT tenant_id, active_booking_provider
         FROM tenant_settings`,
      );
      expect(
        committed.rows.find(
          (row: { tenant_id: string }) => row.tenant_id === 'legacy-tenant-key',
        ),
      ).toEqual({
        tenant_id: 'legacy-tenant-key',
        active_booking_provider: null,
      });
      expect(
        committed.rows.find(
          (row: { tenant_id: string }) => row.tenant_id !== 'legacy-tenant-key',
        ),
      ).toEqual(
        expect.objectContaining({ active_booking_provider: 'google_calendar' }),
      );
    }, 15_000);
  },
);
