import { randomUUID } from "crypto";
import { DataType, newDb } from "pg-mem";
import { databaseEntities } from "../database/entities";

async function main() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: "current_database",
    returns: DataType.text,
    implementation: () => "realtytechai_schema",
  });
  db.public.registerFunction({
    name: "version",
    returns: DataType.text,
    implementation: () => "PostgreSQL 16.0",
  });
  db.public.registerFunction({
    name: "uuid_generate_v4",
    returns: DataType.uuid,
    impure: true,
    implementation: randomUUID,
  });

  const dataSource = db.adapters.createTypeormDataSource({
    type: "postgres",
    entities: [...databaseEntities],
    synchronize: false,
  });
  await dataSource.initialize();

  const schema = await dataSource.driver.createSchemaBuilder().log();
  for (const query of schema.upQueries) {
    process.stdout.write(`${query.query};\n`);
  }

  await dataSource.destroy();
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
