import { randomUUID } from "crypto";
import { DataType, newDb } from "pg-mem";
import { DataSource } from "typeorm";
import { databaseEntities } from "./entities";
import { Team } from "../modules/teams/team.entity";
import { Tenant } from "../modules/tenants/tenant.entity";
import { User } from "../modules/users/user.entity";

function createMemoryDataSource(): DataSource {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: "current_database",
    returns: DataType.text,
    implementation: () => "realtytechai_test",
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
  db.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: randomUUID,
  });

  return db.adapters.createTypeormDataSource({
    type: "postgres",
    entities: [...databaseEntities],
    synchronize: true,
  });
}

describe("database schema", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createMemoryDataSource();
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("creates the complete entity schema from an empty database", () => {
    const tables = new Set(
      dataSource.entityMetadatas.map((metadata) => metadata.tableName),
    );
    expect(tables).toEqual(
      new Set(
        databaseEntities.map(
          (entity) => dataSource.getMetadata(entity).tableName,
        ),
      ),
    );
  });

  it("supports the user lookup used by login", async () => {
    const tenant = await dataSource.getRepository(Tenant).save({
      name: "Schema Test Realty",
      plan: "trial",
      status: "active",
      billingInterval: "month",
      cancelAtPeriodEnd: false,
      timezone: "America/New_York",
    });
    const team = await dataSource.getRepository(Team).save({
      tenantId: tenant.id,
      name: "Sales",
    });
    await dataSource.getRepository(User).save({
      tenantId: tenant.id,
      email: "agent@example.com",
      passwordHash: "not-used-in-this-test",
      role: "agent",
      teamId: team.id,
      isEmailVerified: true,
      emailVerifyToken: null,
      emailVerifyTokenExpiresAt: null,
      isActive: true,
    });

    await expect(
      dataSource
        .getRepository(User)
        .findOne({ where: { email: "missing@example.com" } }),
    ).resolves.toBeNull();
    await expect(
      dataSource
        .getRepository(User)
        .findOne({ where: { email: "agent@example.com" } }),
    ).resolves.toMatchObject({
      tenantId: tenant.id,
      teamId: team.id,
      isActive: true,
    });
  });
});
