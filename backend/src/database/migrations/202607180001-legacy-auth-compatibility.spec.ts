import { randomUUID } from "crypto";
import { DataType, newDb } from "pg-mem";
import { DataSource } from "typeorm";
import { databaseEntities } from "../entities";
import { Tenant } from "../../modules/tenants/tenant.entity";
import { User } from "../../modules/users/user.entity";
import { LegacyAuthCompatibility1784332800001 } from "./202607180001-legacy-auth-compatibility";
import { ClientExperienceReadiness1784851200001 } from "./202607240001-client-experience-readiness";
import { TenantSettingsIntakeKeys1784332800002 } from "./202607180002-tenant-settings-intake-keys";
import { ProductionSchemaReconciliation1784332800004 } from "./202607180004-production-schema-reconciliation";
import { ClientReadinessFoundations1784419200001 } from "./202607190001-client-readiness-foundations";
import { AdminOperationsNotifications1784505600001 } from "./202607200001-admin-operations-notifications";
import { ClientTodayWorkflow1784592000001 } from "./202607210001-client-today-workflow";
import { ServiceSuspension1784764800001 } from "./202607230001-service-suspension";
import { TenantSettings } from "../../modules/settings/tenant-settings.entity";

function memoryDatabase() {
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
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: randomUUID,
  });
  db.public.registerFunction({
    name: "uuid_generate_v4",
    returns: DataType.uuid,
    impure: true,
    implementation: randomUUID,
  });
  return db;
}

describe("legacy auth compatibility migration", () => {
  it("backfills the stale SQL schema and supports old and new accounts", async () => {
    const db = memoryDatabase();
    db.public.none(`
      CREATE TABLE tenants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL UNIQUE,
        slug varchar(255) NOT NULL UNIQUE,
        timezone varchar(255) DEFAULT 'America/New_York',
        quiet_hours_start varchar(10),
        quiet_hours_end varchar(10),
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(255) NOT NULL,
        name varchar(255) NOT NULL,
        password_hash varchar(255) NOT NULL,
        role varchar(50) DEFAULT 'agent',
        tenant_id varchar NOT NULL,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
    `);

    const tenantId = randomUUID();
    const userId = randomUUID();
    const executedSql: string[] = [];
    const querySubscription = db.public.interceptQueries((sql) => {
      executedSql.push(sql);
      return null;
    });
    db.public.none(
      `INSERT INTO tenants (id, name, slug) VALUES ('${tenantId}', 'Legacy Realty', 'legacy-realty')`,
    );
    db.public.none(
      `INSERT INTO users (id, email, name, password_hash, tenant_id) VALUES ('${userId}', 'broker@example.com', 'Broker', 'legacy-hash', '${tenantId}')`,
    );

    const dataSource: DataSource = db.adapters.createTypeormDataSource({
      type: "postgres",
      entities: [...databaseEntities],
      migrations: [
        LegacyAuthCompatibility1784332800001,
        ClientExperienceReadiness1784851200001,
        TenantSettingsIntakeKeys1784332800002,
        ProductionSchemaReconciliation1784332800004,
        ClientReadinessFoundations1784419200001,
        AdminOperationsNotifications1784505600001,
        ClientTodayWorkflow1784592000001,
        ServiceSuspension1784764800001,
      ],
      migrationsRun: true,
      migrationsTableName: "app_migrations",
    });
    await dataSource.initialize();

    expect(
      executedSql.some((sql) =>
        sql.includes('SET "tenantId" = "tenant_id"::text::uuid'),
      ),
    ).toBe(true);
    querySubscription.unsubscribe();

    await expect(
      dataSource.getRepository(User).findOne({
        where: { email: "broker@example.com" },
      }),
    ).resolves.toMatchObject({
      id: userId,
      tenantId,
      passwordHash: "legacy-hash",
      isEmailVerified: true,
      isActive: true,
    });
    await expect(
      dataSource.getRepository(Tenant).findOne({ where: { id: tenantId } }),
    ).resolves.toMatchObject({
      id: tenantId,
      plan: "trial",
      status: "active",
      billingInterval: "month",
    });

    await expect(
      dataSource.getRepository(User).save({
        tenantId,
        email: "new-agent@example.com",
        passwordHash: "new-hash",
        role: "agent",
        teamId: null,
        isEmailVerified: true,
        emailVerifyToken: null,
        emailVerifyTokenExpiresAt: null,
        isActive: true,
      }),
    ).resolves.toMatchObject({ email: "new-agent@example.com" });

    await expect(
      dataSource.getRepository(TenantSettings).save({
        tenantId,
        timeZone: "America/New_York",
        quietHoursStart: "21:00",
        quietHoursEnd: "08:00",
        automationsEnabled: true,
        roundRobinEnabled: false,
        intakeApiKeyHash: "a".repeat(64),
        intakeApiKeyLast4: "test",
        intakeApiKeyRotatedAt: new Date(),
        facebookConnected: false,
      }),
    ).resolves.toMatchObject({ tenantId, intakeApiKeyLast4: "test" });

    await dataSource.destroy();
  });
});
