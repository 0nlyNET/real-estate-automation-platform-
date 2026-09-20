import { randomUUID } from "crypto";
import { DataSource } from "typeorm";
import { AutomationScheduledDueTime1789862400001 } from "./202609200001-automation-scheduled-due-time";

const databaseUrl = process.env.TEST_POSTGRES_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("automation due-time migration on PostgreSQL", () => {
  it("backfills due times, preserves them on re-run, and rolls back without losing jobs", async () => {
    const source = new DataSource({
      type: "postgres",
      url: databaseUrl,
      entities: [],
      extra: { max: 1 },
    });
    await source.initialize();
    const runner = source.createQueryRunner();
    const schema = `automation_due_${randomUUID().replace(/-/g, "")}`;
    try {
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET search_path TO "${schema}", public`);
      for (const table of ["durable_jobs", "sequence_enrollments"]) {
        await runner.query(
          `CREATE TABLE "${table}" (id integer PRIMARY KEY, next_run_at timestamptz)`,
        );
        await runner.query(
          `INSERT INTO "${table}" VALUES (1, '2026-09-01T00:00:00Z'), (2, NULL)`,
        );
      }
      const migration = new AutomationScheduledDueTime1789862400001();
      await runner.startTransaction();
      await migration.up(runner);
      await runner.commitTransaction();
      for (const table of ["durable_jobs", "sequence_enrollments"]) {
        await runner.query(
          `UPDATE "${table}" SET next_run_at = '2026-09-20T00:00:00Z' WHERE id = 1`,
        );
      }
      await migration.up(runner);
      for (const table of ["durable_jobs", "sequence_enrollments"]) {
        const rows = await runner.query(
          `SELECT scheduled_run_at FROM "${table}" ORDER BY id`,
        );
        expect(rows[0].scheduled_run_at.toISOString()).toBe(
          "2026-09-01T00:00:00.000Z",
        );
        expect(rows[1].scheduled_run_at).toBeNull();
      }
      await migration.down(runner);
      for (const table of ["durable_jobs", "sequence_enrollments"]) {
        expect(
          await runner.query(`SELECT id FROM "${table}" ORDER BY id`),
        ).toEqual([{ id: 1 }, { id: 2 }]);
      }
      await migration.up(runner);
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.query("SET search_path TO public");
      await runner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await runner.release();
      await source.destroy();
    }
  });
});
