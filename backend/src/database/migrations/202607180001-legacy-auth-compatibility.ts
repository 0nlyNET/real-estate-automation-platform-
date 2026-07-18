import { MigrationInterface, QueryRunner } from "typeorm";

type ColumnDefinition = {
  name: string;
  sql: string;
};

const tenantColumns: ColumnDefinition[] = [
  { name: "id", sql: "uuid NOT NULL DEFAULT gen_random_uuid()" },
  { name: "name", sql: "text" },
  { name: "plan", sql: "text NOT NULL DEFAULT 'trial'" },
  { name: "status", sql: "text NOT NULL DEFAULT 'active'" },
  { name: "billingInterval", sql: "text NOT NULL DEFAULT 'month'" },
  { name: "trialEndsAt", sql: "timestamptz" },
  { name: "currentPeriodEnd", sql: "timestamptz" },
  {
    name: "cancelAtPeriodEnd",
    sql: "boolean NOT NULL DEFAULT false",
  },
  { name: "cancelAt", sql: "timestamptz" },
  { name: "stripeCustomerId", sql: "text" },
  { name: "stripeSubscriptionId", sql: "text" },
  { name: "stripeSubscriptionStatus", sql: "text" },
  { name: "stripePriceId", sql: "text" },
  { name: "bookingLink", sql: "text" },
  {
    name: "timezone",
    sql: "text NOT NULL DEFAULT 'America/New_York'",
  },
  { name: "quietHoursStart", sql: "text" },
  { name: "quietHoursEnd", sql: "text" },
  { name: "createdAt", sql: "timestamp NOT NULL DEFAULT now()" },
  { name: "updatedAt", sql: "timestamp NOT NULL DEFAULT now()" },
];

const userColumns: ColumnDefinition[] = [
  { name: "id", sql: "uuid NOT NULL DEFAULT gen_random_uuid()" },
  { name: "tenantId", sql: "uuid" },
  { name: "email", sql: "varchar(255) NOT NULL" },
  { name: "passwordHash", sql: "varchar(255)" },
  { name: "role", sql: "varchar(50) NOT NULL DEFAULT 'agent'" },
  { name: "teamId", sql: "uuid" },
  {
    name: "isEmailVerified",
    sql: "boolean NOT NULL DEFAULT false",
  },
  { name: "emailVerifyToken", sql: "varchar(255)" },
  { name: "emailVerifyTokenExpiresAt", sql: "timestamptz" },
  { name: "isActive", sql: "boolean NOT NULL DEFAULT true" },
];

function quoted(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function tableExists(queryRunner: QueryRunner, table: string) {
  const rows = await queryRunner.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

async function columnNames(queryRunner: QueryRunner, table: string) {
  const rows: Array<{ column_name: string }> = await queryRunner.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return new Set(rows.map((row) => row.column_name));
}

async function ensureTableAndColumns(
  queryRunner: QueryRunner,
  table: string,
  definitions: ColumnDefinition[],
) {
  if (!(await tableExists(queryRunner, table))) {
    const columns = definitions
      .map((column) => `${quoted(column.name)} ${column.sql}`)
      .join(", ");
    await queryRunner.query(
      `CREATE TABLE ${quoted(table)} (${columns}, PRIMARY KEY (${quoted("id")}))`,
    );
    return new Set(definitions.map((definition) => definition.name));
  }

  const existing = await columnNames(queryRunner, table);
  const added = new Set<string>();
  for (const definition of definitions) {
    if (existing.has(definition.name)) continue;
    if (definition.name === "id") {
      throw new Error(
        `${table}.id is missing; refusing an unsafe identity repair`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE ${quoted(table)} ADD COLUMN ${quoted(definition.name)} ${definition.sql}`,
    );
    added.add(definition.name);
  }
  return added;
}

export class LegacyAuthCompatibility1784332800001 implements MigrationInterface {
  name = "LegacyAuthCompatibility1784332800001";

  async up(queryRunner: QueryRunner): Promise<void> {
    const tenantColumnsAdded = await ensureTableAndColumns(
      queryRunner,
      "tenants",
      tenantColumns,
    );
    const currentTenantColumns = await columnNames(queryRunner, "tenants");

    if (
      tenantColumnsAdded.has("createdAt") &&
      currentTenantColumns.has("created_at")
    ) {
      await queryRunner.query(
        'UPDATE "tenants" SET "createdAt" = "created_at" WHERE "created_at" IS NOT NULL',
      );
    }
    if (
      tenantColumnsAdded.has("updatedAt") &&
      currentTenantColumns.has("updated_at")
    ) {
      await queryRunner.query(
        'UPDATE "tenants" SET "updatedAt" = "updated_at" WHERE "updated_at" IS NOT NULL',
      );
    }
    if (
      tenantColumnsAdded.has("quietHoursStart") &&
      currentTenantColumns.has("quiet_hours_start")
    ) {
      await queryRunner.query(
        'UPDATE "tenants" SET "quietHoursStart" = "quiet_hours_start" WHERE "quiet_hours_start" IS NOT NULL',
      );
    }
    if (
      tenantColumnsAdded.has("quietHoursEnd") &&
      currentTenantColumns.has("quiet_hours_end")
    ) {
      await queryRunner.query(
        'UPDATE "tenants" SET "quietHoursEnd" = "quiet_hours_end" WHERE "quiet_hours_end" IS NOT NULL',
      );
    }
    if (currentTenantColumns.has("slug")) {
      await queryRunner.query(
        'ALTER TABLE "tenants" ALTER COLUMN "slug" DROP NOT NULL',
      );
    }

    const userColumnsAdded = await ensureTableAndColumns(
      queryRunner,
      "users",
      userColumns,
    );
    const currentUserColumns = await columnNames(queryRunner, "users");

    if (
      userColumnsAdded.has("tenantId") &&
      currentUserColumns.has("tenant_id")
    ) {
      await queryRunner.query(
        'UPDATE "users" SET "tenantId" = "tenant_id" WHERE "tenantId" IS NULL',
      );
    }
    if (
      userColumnsAdded.has("passwordHash") &&
      currentUserColumns.has("password_hash")
    ) {
      await queryRunner.query(
        'UPDATE "users" SET "passwordHash" = "password_hash" WHERE "passwordHash" IS NULL',
      );
    }
    if (userColumnsAdded.has("isEmailVerified")) {
      await queryRunner.query(
        'UPDATE "users" SET "isEmailVerified" = true WHERE "passwordHash" IS NOT NULL',
      );
    }
    if (currentUserColumns.has("name")) {
      await queryRunner.query(
        'ALTER TABLE "users" ALTER COLUMN "name" DROP NOT NULL',
      );
    }
    if (currentUserColumns.has("tenant_id")) {
      await queryRunner.query(
        'ALTER TABLE "users" ALTER COLUMN "tenant_id" DROP NOT NULL',
      );
    }
    if (currentUserColumns.has("password_hash")) {
      await queryRunner.query(
        'ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL',
      );
    }

    const [{ count: usersWithoutTenant }] = await queryRunner.query(
      'SELECT COUNT(*)::int AS count FROM "users" WHERE "tenantId" IS NULL',
    );
    if (Number(usersWithoutTenant) === 0) {
      await queryRunner.query(
        'ALTER TABLE "users" ALTER COLUMN "tenantId" SET NOT NULL',
      );
    }
  }

  async down(): Promise<void> {
    // Compatibility migrations are intentionally irreversible: removing the
    // backfilled columns would destroy account and billing data.
  }
}
