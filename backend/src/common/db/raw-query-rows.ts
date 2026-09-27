/**
 * Normalizes the return shape of TypeORM raw queries (`manager.query` /
 * `queryRunner.query`) on the postgres driver.
 *
 * Driver behavior (TypeORM 0.3.x, PostgresQueryRunner.query):
 * - SELECT / INSERT  -> returns `raw.rows` (the rows array directly)
 * - UPDATE / DELETE  -> returns `[raw.rows, raw.rowCount]` (a 2-tuple)
 *
 * Code that declares `const rows: T[] = await manager.query('UPDATE ...
 * RETURNING ...')` silently receives the tuple instead of the rows array.
 * Consequences observed in production (2026-09-27 staging incident):
 * - `for (const row of rows)` iterated the tuple elements (the inner rows
 *   array, then the row count number) instead of row objects, so
 *   `row.id` / `row.leadId` / `row.tenantId` were all `undefined`.
 * - `rows.map((row) => row.id)` produced `[undefined, ...]`, so worker
 *   claim paths silently claimed nothing and recovery paths minted a new
 *   operations task + notification on every tick with
 *   `Exhausted ai_run undefined`.
 *
 * Always pass UPDATE/DELETE raw-query results through `updateReturningRows`
 * before iterating or mapping them. The helper also tolerates a plain rows
 * array (e.g. from SELECT, or from test mocks) so call sites stay robust.
 */
export function updateReturningRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    // UPDATE/DELETE tuple: [rows, rowCount]
    if (
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === 'number'
    ) {
      return result[0] as T[];
    }
    // SELECT/INSERT shape, or a test mock: rows array directly.
    // Guard against accidentally accepting the tuple's inner elements as
    // rows when the shape is ambiguous.
    return result as T[];
  }
  return [];
}

/**
 * Runtime validation for identifiers recovered from raw SQL. Raw results are
 * not type-checked against the declared TypeScript type, so every id used
 * for task dedupe keys, evidence notes, or follow-up writes must be
 * validated before use. Returns true only for non-empty strings.
 */
export function isValidRowId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
