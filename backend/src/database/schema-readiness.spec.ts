import { DataType, newDb } from "pg-mem";
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from "typeorm";
import { inspectDatabaseSchema } from "./schema-readiness";

@Entity("schema_probe")
class SchemaProbe {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  value!: string;
}

function createMemoryDataSource(synchronize: boolean): DataSource {
  const db = newDb();
  db.public.registerFunction({
    name: "current_database",
    returns: DataType.text,
    implementation: () => "realtytechai_test",
  });
  db.public.registerFunction({
    name: "current_schema",
    returns: DataType.text,
    implementation: () => "public",
  });
  db.public.registerFunction({
    name: "version",
    returns: DataType.text,
    implementation: () => "PostgreSQL 16.0",
  });

  return db.adapters.createTypeormDataSource({
    type: "postgres",
    entities: [SchemaProbe],
    synchronize,
  });
}

describe("database schema readiness", () => {
  it("reports a complete schema", async () => {
    const dataSource = createMemoryDataSource(true);
    await dataSource.initialize();

    await expect(inspectDatabaseSchema(dataSource)).resolves.toMatchObject({
      ok: true,
      expectedTables: 1,
      actualTables: 1,
      missingTables: [],
      missingColumns: [],
    });

    await dataSource.destroy();
  });

  it("reports missing tables without exposing database values", async () => {
    const dataSource = createMemoryDataSource(false);
    await dataSource.initialize();

    await expect(inspectDatabaseSchema(dataSource)).resolves.toMatchObject({
      ok: false,
      expectedTables: 1,
      actualTables: 0,
      missingTables: ["schema_probe"],
    });

    await dataSource.destroy();
  });
});
