import { createHash } from "crypto";
import { DataSource } from "typeorm";

export type SchemaReadinessReport = {
  ok: boolean;
  expectedTables: number;
  actualTables: number;
  missingTables: string[];
  missingColumns: Array<{ table: string; column: string }>;
  fingerprint: string;
};

export async function inspectDatabaseSchema(
  dataSource: DataSource,
): Promise<SchemaReadinessReport> {
  const rows: Array<{ table_name: string; column_name: string }> =
    await dataSource.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
    `);

  const actual = new Map<string, Set<string>>();
  for (const row of rows) {
    const columns = actual.get(row.table_name) || new Set<string>();
    columns.add(row.column_name);
    actual.set(row.table_name, columns);
  }

  const expected = new Map<string, Set<string>>();
  for (const metadata of dataSource.entityMetadatas) {
    expected.set(
      metadata.tableName,
      new Set(metadata.columns.map((column) => column.databaseName)),
    );
  }

  const missingTables = [...expected.keys()]
    .filter((table) => !actual.has(table))
    .sort();
  const missingColumns: Array<{ table: string; column: string }> = [];

  for (const [table, columns] of expected) {
    const actualColumns = actual.get(table);
    if (!actualColumns) continue;
    for (const column of columns) {
      if (!actualColumns.has(column)) missingColumns.push({ table, column });
    }
  }
  missingColumns.sort((a, b) =>
    `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`),
  );

  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ missingTables, missingColumns }))
    .digest("hex")
    .slice(0, 12);

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0,
    expectedTables: expected.size,
    actualTables: actual.size,
    missingTables,
    missingColumns,
    fingerprint,
  };
}
