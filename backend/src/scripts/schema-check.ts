import "dotenv/config";
import { DataSource } from "typeorm";
import { buildDatabaseOptions } from "../database/database-options";
import { inspectDatabaseSchema } from "../database/schema-readiness";

async function main() {
  const dataSource = new DataSource(buildDatabaseOptions());
  await dataSource.initialize();
  const report = await inspectDatabaseSchema(dataSource);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await dataSource.destroy();
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
