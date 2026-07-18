import { MigrationInterface, QueryRunner } from "typeorm";

type ColumnDefinition = {
  name: string;
  createSql: string;
  addSql?: string;
};

type TableDefinition = {
  name: string;
  columns: ColumnDefinition[];
};

const id: ColumnDefinition = {
  name: "id",
  createSql: "uuid NOT NULL DEFAULT gen_random_uuid()",
};
const createdAt: ColumnDefinition = {
  name: "created_at",
  createSql: "timestamp NOT NULL DEFAULT now()",
};
const updatedAt: ColumnDefinition = {
  name: "updated_at",
  createSql: "timestamp NOT NULL DEFAULT now()",
};

const tables: TableDefinition[] = [
  {
    name: "tenants",
    columns: [
      id,
      { name: "name", createSql: "text" },
      { name: "plan", createSql: "text NOT NULL DEFAULT 'trial'" },
      { name: "status", createSql: "text NOT NULL DEFAULT 'active'" },
      {
        name: "billingInterval",
        createSql: "text NOT NULL DEFAULT 'month'",
      },
      { name: "trialEndsAt", createSql: "timestamptz" },
      { name: "currentPeriodEnd", createSql: "timestamptz" },
      {
        name: "cancelAtPeriodEnd",
        createSql: "boolean NOT NULL DEFAULT false",
      },
      { name: "cancelAt", createSql: "timestamptz" },
      { name: "stripeCustomerId", createSql: "text" },
      { name: "stripeSubscriptionId", createSql: "text" },
      { name: "stripeSubscriptionStatus", createSql: "text" },
      { name: "stripePriceId", createSql: "text" },
      { name: "bookingLink", createSql: "text" },
      {
        name: "timezone",
        createSql: "text NOT NULL DEFAULT 'America/New_York'",
      },
      { name: "quietHoursStart", createSql: "text" },
      { name: "quietHoursEnd", createSql: "text" },
      {
        name: "createdAt",
        createSql: "timestamp NOT NULL DEFAULT now()",
      },
      {
        name: "updatedAt",
        createSql: "timestamp NOT NULL DEFAULT now()",
      },
    ],
  },
  {
    name: "users",
    columns: [
      id,
      { name: "tenantId", createSql: "uuid NOT NULL", addSql: "uuid" },
      {
        name: "email",
        createSql: "varchar(255) NOT NULL",
        addSql: "varchar(255)",
      },
      { name: "passwordHash", createSql: "varchar(255)" },
      {
        name: "role",
        createSql: "varchar(50) NOT NULL DEFAULT 'agent'",
      },
      { name: "teamId", createSql: "uuid" },
      {
        name: "isEmailVerified",
        createSql: "boolean NOT NULL DEFAULT false",
      },
      { name: "emailVerifyToken", createSql: "varchar(255)" },
      { name: "emailVerifyTokenExpiresAt", createSql: "timestamptz" },
      {
        name: "isActive",
        createSql: "boolean NOT NULL DEFAULT true",
      },
    ],
  },
  {
    name: "teams",
    columns: [
      id,
      { name: "tenantId", createSql: "uuid NOT NULL", addSql: "uuid" },
      {
        name: "name",
        createSql: "varchar(120) NOT NULL",
        addSql: "varchar(120)",
      },
      {
        name: "createdAt",
        createSql: "timestamp NOT NULL DEFAULT now()",
      },
    ],
  },
  {
    name: "leads",
    columns: [
      id,
      createdAt,
      updatedAt,
      {
        name: "full_name",
        createSql: "varchar NOT NULL",
        addSql: "varchar",
      },
      { name: "stage", createSql: "varchar NOT NULL DEFAULT 'new'" },
      { name: "score", createSql: "integer NOT NULL DEFAULT 50" },
      { name: "first_contact_sent_at", createSql: "timestamptz" },
      { name: "first_response_received_at", createSql: "timestamptz" },
      { name: "first_response_time_sec", createSql: "integer" },
      { name: "timeline", createSql: "varchar" },
      { name: "buy_or_rent", createSql: "varchar" },
      { name: "preapproved", createSql: "varchar" },
      { name: "best_time_to_talk", createSql: "varchar" },
      { name: "tags", createSql: "text" },
      { name: "email", createSql: "varchar" },
      { name: "phone", createSql: "varchar" },
      { name: "source", createSql: "varchar" },
      { name: "location", createSql: "varchar" },
      { name: "property_interest", createSql: "varchar" },
      { name: "budget_range", createSql: "varchar" },
      { name: "estimated_price", createSql: "varchar" },
      { name: "preferred_areas", createSql: "text" },
      { name: "notes", createSql: "text" },
      { name: "last_activity_at", createSql: "timestamptz" },
      { name: "last_contacted_at", createSql: "timestamptz" },
      { name: "next_follow_up_at", createSql: "timestamptz" },
      {
        name: "lead_type",
        createSql: "varchar NOT NULL DEFAULT 'buyer'",
      },
      {
        name: "temperature",
        createSql: "varchar NOT NULL DEFAULT 'warm'",
      },
      { name: "assigned_to", createSql: "varchar" },
      { name: "assigned_to_user_id", createSql: "uuid" },
      { name: "assigned_to_team_id", createSql: "uuid" },
      {
        name: "sequence_status",
        createSql: "varchar NOT NULL DEFAULT 'idle'",
      },
      { name: "tenant_id", createSql: "uuid NOT NULL", addSql: "uuid" },
    ],
  },
  {
    name: "lead_events",
    columns: [
      id,
      createdAt,
      updatedAt,
      {
        name: "event_type",
        createSql: "varchar NOT NULL",
        addSql: "varchar",
      },
      { name: "metadata", createSql: "jsonb" },
      { name: "leadId", createSql: "uuid" },
    ],
  },
  {
    name: "messages",
    columns: [
      id,
      createdAt,
      updatedAt,
      { name: "leadId", createSql: "uuid NOT NULL", addSql: "uuid" },
      {
        name: "channel",
        createSql: "varchar NOT NULL",
        addSql: "varchar",
      },
      {
        name: "direction",
        createSql: "varchar NOT NULL",
        addSql: "varchar",
      },
      { name: "body", createSql: "text NOT NULL", addSql: "text" },
      { name: "provider_message_id", createSql: "varchar" },
      {
        name: "status",
        createSql: "varchar NOT NULL DEFAULT 'pending'",
      },
      { name: "scheduled_at", createSql: "timestamptz" },
      { name: "sent_at", createSql: "timestamptz" },
      {
        name: "attempt_count",
        createSql: "integer NOT NULL DEFAULT 0",
      },
      { name: "last_error", createSql: "text" },
    ],
  },
  {
    name: "sequences",
    columns: [
      id,
      createdAt,
      updatedAt,
      { name: "tenant_id", createSql: "uuid" },
      { name: "name", createSql: "varchar(255)" },
      { name: "description", createSql: "text" },
      { name: "active", createSql: "boolean NOT NULL DEFAULT true" },
      { name: "lead_type", createSql: "varchar(50)" },
      { name: "temperature", createSql: "varchar(50)" },
    ],
  },
  {
    name: "sequence_enrollments",
    columns: [
      id,
      createdAt,
      updatedAt,
      {
        name: "status",
        createSql: "varchar NOT NULL DEFAULT 'active'",
      },
      {
        name: "current_step_index",
        createSql: "integer NOT NULL DEFAULT 0",
      },
      { name: "next_run_at", createSql: "timestamptz" },
      { name: "stopped_reason", createSql: "varchar" },
      { name: "sequenceId", createSql: "uuid" },
      { name: "leadId", createSql: "uuid" },
    ],
  },
  {
    name: "sequence_steps",
    columns: [
      id,
      createdAt,
      updatedAt,
      {
        name: "offsetMinutes",
        createSql: "integer NOT NULL",
        addSql: "integer",
      },
      {
        name: "channel",
        createSql: "varchar NOT NULL",
        addSql: "varchar",
      },
      { name: "template", createSql: "text NOT NULL", addSql: "text" },
      { name: "sequenceId", createSql: "uuid" },
    ],
  },
  {
    name: "credentials",
    columns: [
      id,
      createdAt,
      updatedAt,
      {
        name: "provider",
        createSql: "varchar NOT NULL",
        addSql: "varchar",
      },
      { name: "routingKey", createSql: "varchar" },
      {
        name: "encryptedValue",
        createSql: "text NOT NULL",
        addSql: "text",
      },
      { name: "tenantId", createSql: "uuid" },
    ],
  },
  {
    name: "tenant_settings",
    columns: [
      id,
      createdAt,
      updatedAt,
      {
        name: "tenant_id",
        createSql: "varchar NOT NULL",
        addSql: "varchar",
      },
      {
        name: "time_zone",
        createSql: "varchar NOT NULL DEFAULT 'America/New_York'",
      },
      {
        name: "quiet_hours_start",
        createSql: "varchar NOT NULL DEFAULT '21:00'",
      },
      {
        name: "quiet_hours_end",
        createSql: "varchar NOT NULL DEFAULT '08:00'",
      },
      { name: "booking_link", createSql: "varchar" },
      {
        name: "automations_enabled",
        createSql: "boolean NOT NULL DEFAULT true",
      },
      {
        name: "round_robin_enabled",
        createSql: "boolean NOT NULL DEFAULT false",
      },
      { name: "round_robin_team_id", createSql: "varchar" },
      { name: "round_robin_last_user_id", createSql: "varchar" },
      { name: "zapier_api_key_hash", createSql: "varchar" },
      { name: "zapier_api_key_last4", createSql: "varchar" },
      { name: "intake_api_key_hash", createSql: "varchar" },
      { name: "intake_api_key_last4", createSql: "varchar" },
      { name: "intake_api_key_rotated_at", createSql: "timestamptz" },
      { name: "webhook_url", createSql: "varchar" },
      { name: "webhook_events", createSql: "text" },
      {
        name: "facebook_connected",
        createSql: "boolean NOT NULL DEFAULT false",
      },
      { name: "facebook_page_name", createSql: "varchar" },
      { name: "facebook_form_id", createSql: "varchar" },
      { name: "twilio_account_sid", createSql: "varchar" },
      { name: "twilio_auth_token_enc", createSql: "varchar" },
      { name: "twilio_from_number", createSql: "varchar" },
      { name: "twilio_messaging_service_sid", createSql: "varchar" },
      { name: "sendgrid_api_key_enc", createSql: "varchar" },
      { name: "sendgrid_from_email", createSql: "varchar" },
      { name: "sendgrid_from_name", createSql: "varchar" },
      { name: "lead_source", createSql: "varchar" },
      { name: "lead_source_other_label", createSql: "varchar" },
    ],
  },
  {
    name: "routing_rules",
    columns: [
      id,
      { name: "tenantId", createSql: "uuid NOT NULL", addSql: "uuid" },
      { name: "name", createSql: "text NOT NULL", addSql: "text" },
      {
        name: "isActive",
        createSql: "boolean NOT NULL DEFAULT true",
      },
      { name: "priority", createSql: "integer NOT NULL DEFAULT 100" },
      {
        name: "conditions",
        createSql: "jsonb NOT NULL DEFAULT '{}'::jsonb",
      },
      {
        name: "actionType",
        createSql: "text NOT NULL",
        addSql: "text",
      },
      {
        name: "actionConfig",
        createSql: "jsonb NOT NULL DEFAULT '{}'::jsonb",
      },
      {
        name: "createdAt",
        createSql: "timestamp NOT NULL DEFAULT now()",
      },
      {
        name: "updatedAt",
        createSql: "timestamp NOT NULL DEFAULT now()",
      },
    ],
  },
  {
    name: "routing_assignment_logs",
    columns: [
      id,
      { name: "tenantId", createSql: "uuid NOT NULL", addSql: "uuid" },
      { name: "ruleId", createSql: "uuid" },
      { name: "leadId", createSql: "uuid NOT NULL", addSql: "uuid" },
      { name: "assignedToUserId", createSql: "uuid" },
      { name: "assignedToTeamId", createSql: "uuid" },
      { name: "decision", createSql: "text NOT NULL", addSql: "text" },
      { name: "meta", createSql: "jsonb" },
      {
        name: "createdAt",
        createSql: "timestamp NOT NULL DEFAULT now()",
      },
    ],
  },
  {
    name: "agent_presence",
    columns: [
      id,
      { name: "tenantId", createSql: "uuid NOT NULL", addSql: "uuid" },
      { name: "userId", createSql: "uuid NOT NULL", addSql: "uuid" },
      { name: "status", createSql: "text NOT NULL DEFAULT 'offline'" },
      { name: "lastSeenAt", createSql: "timestamptz" },
      { name: "meta", createSql: "jsonb" },
      {
        name: "createdAt",
        createSql: "timestamp NOT NULL DEFAULT now()",
      },
      {
        name: "updatedAt",
        createSql: "timestamp NOT NULL DEFAULT now()",
      },
    ],
  },
  {
    name: "compliance_optouts",
    columns: [
      id,
      { name: "tenantId", createSql: "uuid NOT NULL", addSql: "uuid" },
      { name: "channel", createSql: "text NOT NULL", addSql: "text" },
      { name: "value", createSql: "text NOT NULL", addSql: "text" },
      {
        name: "reason",
        createSql: "text NOT NULL DEFAULT 'user_request'",
      },
      { name: "source", createSql: "text NOT NULL DEFAULT 'manual'" },
      {
        name: "createdAt",
        createSql: "timestamp NOT NULL DEFAULT now()",
      },
    ],
  },
  {
    name: "compliance_events",
    columns: [
      id,
      { name: "tenantId", createSql: "uuid NOT NULL", addSql: "uuid" },
      { name: "type", createSql: "text NOT NULL", addSql: "text" },
      { name: "channel", createSql: "text" },
      { name: "leadId", createSql: "uuid" },
      { name: "userId", createSql: "uuid" },
      { name: "messageId", createSql: "uuid" },
      { name: "to", createSql: "text" },
      { name: "payload", createSql: "jsonb" },
      {
        name: "createdAt",
        createSql: "timestamp NOT NULL DEFAULT now()",
      },
    ],
  },
  {
    name: "tenant_quiet_hours",
    columns: [
      id,
      { name: "tenantId", createSql: "uuid NOT NULL", addSql: "uuid" },
      { name: "enabled", createSql: "boolean NOT NULL DEFAULT false" },
      { name: "startMinute", createSql: "integer NOT NULL DEFAULT 0" },
      { name: "endMinute", createSql: "integer NOT NULL DEFAULT 0" },
      {
        name: "timezone",
        createSql: "text NOT NULL DEFAULT 'America/New_York'",
      },
      {
        name: "createdAt",
        createSql: "timestamp NOT NULL DEFAULT now()",
      },
      {
        name: "updatedAt",
        createSql: "timestamp NOT NULL DEFAULT now()",
      },
    ],
  },
  {
    name: "password_reset_tokens",
    columns: [
      id,
      createdAt,
      updatedAt,
      { name: "token_hash", createSql: "varchar NOT NULL", addSql: "varchar" },
      {
        name: "expires_at",
        createSql: "timestamptz NOT NULL",
        addSql: "timestamptz",
      },
      { name: "used_at", createSql: "timestamptz" },
      { name: "userId", createSql: "uuid" },
    ],
  },
  {
    name: "support_tickets",
    columns: [
      id,
      createdAt,
      updatedAt,
      { name: "userId", createSql: "uuid NOT NULL", addSql: "uuid" },
      {
        name: "email",
        createSql: "varchar(255) NOT NULL",
        addSql: "varchar(255)",
      },
      { name: "name", createSql: "varchar(255)" },
      {
        name: "subject",
        createSql: "varchar(255) NOT NULL",
        addSql: "varchar(255)",
      },
      { name: "message", createSql: "text NOT NULL", addSql: "text" },
      {
        name: "status",
        createSql: "varchar(50) NOT NULL DEFAULT 'open'",
      },
      { name: "tenantId", createSql: "uuid" },
    ],
  },
  {
    name: "audit_logs",
    columns: [
      id,
      createdAt,
      updatedAt,
      { name: "tenantId", createSql: "uuid NOT NULL", addSql: "uuid" },
      { name: "actorId", createSql: "uuid NOT NULL", addSql: "uuid" },
      { name: "actorEmail", createSql: "varchar" },
      {
        name: "action",
        createSql: "varchar NOT NULL",
        addSql: "varchar NOT NULL DEFAULT 'unknown'",
      },
      {
        name: "method",
        createSql: "varchar NOT NULL",
        addSql: "varchar NOT NULL DEFAULT 'UNKNOWN'",
      },
      {
        name: "path",
        createSql: "varchar NOT NULL",
        addSql: "varchar NOT NULL DEFAULT '/'",
      },
      {
        name: "statusCode",
        createSql: "integer NOT NULL",
        addSql: "integer NOT NULL DEFAULT 200",
      },
      { name: "metadata", createSql: "jsonb" },
    ],
  },
];

const indexStatements = [
  'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_email" ON "users" ("email")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_teams_tenant_name" ON "teams" ("tenantId", "name")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_leads_tenant_email" ON "leads" ("tenant_id", "email") WHERE "email" IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_leads_tenant_phone" ON "leads" ("tenant_id", "phone") WHERE "phone" IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_messages_provider_message_id" ON "messages" ("provider_message_id") WHERE "provider_message_id" IS NOT NULL',
  'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenant_settings_tenant_id" ON "tenant_settings" ("tenant_id")',
  'CREATE INDEX IF NOT EXISTS "IDX_credentials_tenant_provider" ON "credentials" ("tenantId", "provider")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_credentials_provider_routing_key" ON "credentials" ("provider", "routingKey") WHERE "routingKey" IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS "IDX_routing_rules_tenant_active" ON "routing_rules" ("tenantId", "isActive")',
  'CREATE INDEX IF NOT EXISTS "IDX_routing_rules_tenant_priority" ON "routing_rules" ("tenantId", "priority")',
  'CREATE INDEX IF NOT EXISTS "IDX_routing_logs_tenant_created" ON "routing_assignment_logs" ("tenantId", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "IDX_routing_logs_tenant_lead" ON "routing_assignment_logs" ("tenantId", "leadId")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_agent_presence_tenant_user" ON "agent_presence" ("tenantId", "userId")',
  'CREATE INDEX IF NOT EXISTS "IDX_agent_presence_tenant_status" ON "agent_presence" ("tenantId", "status")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_compliance_optouts_tenant_channel_value" ON "compliance_optouts" ("tenantId", "channel", "value")',
  'CREATE INDEX IF NOT EXISTS "IDX_compliance_events_tenant_created" ON "compliance_events" ("tenantId", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "IDX_compliance_events_tenant_type" ON "compliance_events" ("tenantId", "type")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenant_quiet_hours_tenant" ON "tenant_quiet_hours" ("tenantId")',
  'CREATE INDEX IF NOT EXISTS "IDX_password_reset_tokens_token_hash" ON "password_reset_tokens" ("token_hash")',
  'CREATE INDEX IF NOT EXISTS "IDX_password_reset_tokens_userId" ON "password_reset_tokens" ("userId")',
  'CREATE INDEX IF NOT EXISTS "IDX_support_tickets_user" ON "support_tickets" ("userId")',
  'CREATE INDEX IF NOT EXISTS "IDX_audit_logs_tenant_created" ON "audit_logs" ("tenantId", "created_at")',
];

function quoted(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

async function tableExists(queryRunner: QueryRunner, table: string) {
  const rows = await queryRunner.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

async function columnNames(queryRunner: QueryRunner, table: string) {
  const rows: Array<{ column_name: string }> = await queryRunner.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1`,
    [table],
  );
  return new Set(rows.map((row) => row.column_name));
}

async function ensureTable(queryRunner: QueryRunner, table: TableDefinition) {
  if (!(await tableExists(queryRunner, table.name))) {
    const columns = table.columns
      .map((column) => `${quoted(column.name)} ${column.createSql}`)
      .join(", ");
    await queryRunner.query(
      `CREATE TABLE ${quoted(table.name)} (${columns}, PRIMARY KEY (${quoted("id")}))`,
    );
    return new Set(table.columns.map((column) => column.name));
  }

  const existing = await columnNames(queryRunner, table.name);
  const added = new Set<string>();
  for (const column of table.columns) {
    if (existing.has(column.name)) continue;
    if (column.name === "id") {
      throw new Error(
        `${table.name}.id is missing; refusing an unsafe identity repair`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE ${quoted(table.name)} ADD COLUMN ${quoted(column.name)} ${column.addSql || column.createSql}`,
    );
    added.add(column.name);
  }
  return added;
}

async function backfillAlias(
  queryRunner: QueryRunner,
  table: string,
  target: string,
  source: string,
) {
  const columns = await columnNames(queryRunner, table);
  if (!columns.has(target) || !columns.has(source)) return;
  await queryRunner.query(
    `UPDATE ${quoted(table)}
     SET ${quoted(target)} = ${quoted(source)}
     WHERE ${quoted(target)} IS NULL AND ${quoted(source)} IS NOT NULL`,
  );
}

async function dropLegacyNotNull(
  queryRunner: QueryRunner,
  table: string,
  column: string,
) {
  const columns = await columnNames(queryRunner, table);
  if (!columns.has(column)) return;
  await queryRunner.query(
    `ALTER TABLE ${quoted(table)} ALTER COLUMN ${quoted(column)} DROP NOT NULL`,
  );
}

async function setNotNullWhenComplete(
  queryRunner: QueryRunner,
  table: string,
  column: string,
) {
  const [{ count }] = await queryRunner.query(
    `SELECT COUNT(*)::int AS count
     FROM ${quoted(table)}
     WHERE ${quoted(column)} IS NULL`,
  );
  if (Number(count) === 0) {
    await queryRunner.query(
      `ALTER TABLE ${quoted(table)} ALTER COLUMN ${quoted(column)} SET NOT NULL`,
    );
  }
}

async function backfillAuditActors(queryRunner: QueryRunner) {
  const auditColumns = await columnNames(queryRunner, "audit_logs");
  if (!auditColumns.has("actor_id") || !auditColumns.has("actorId")) return;

  const [{ count }] = await queryRunner.query(`
    SELECT COUNT(*)::int AS count
    FROM "audit_logs"
    WHERE "actorId" IS NULL AND "actor_id" IS NOT NULL
  `);
  if (Number(count) === 0) return;

  await queryRunner.query(
    'DROP TRIGGER IF EXISTS "TRG_audit_logs_immutable" ON "audit_logs"',
  );
  await queryRunner.query(`
    UPDATE "audit_logs"
    SET "actorId" = "actor_id"
    WHERE "actorId" IS NULL AND "actor_id" IS NOT NULL
  `);
  await queryRunner.query(`
    UPDATE "audit_logs" AS audit
    SET "tenantId" = users."tenantId"
    FROM "users" AS users
    WHERE audit."tenantId" IS NULL
      AND audit."actorId" = users."id"
  `);
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit logs are immutable';
    END;
    $$ LANGUAGE plpgsql
  `);
  await queryRunner.query(`
    CREATE TRIGGER "TRG_audit_logs_immutable"
    BEFORE UPDATE OR DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation()
  `);
}

export class ProductionSchemaReconciliation1784332800004 implements MigrationInterface {
  name = "ProductionSchemaReconciliation1784332800004";

  async up(queryRunner: QueryRunner): Promise<void> {
    const addedByTable = new Map<string, Set<string>>();
    for (const table of tables) {
      addedByTable.set(table.name, await ensureTable(queryRunner, table));
    }

    await backfillAlias(queryRunner, "tenants", "createdAt", "created_at");
    await backfillAlias(queryRunner, "tenants", "updatedAt", "updated_at");
    await backfillAlias(
      queryRunner,
      "tenants",
      "quietHoursStart",
      "quiet_hours_start",
    );
    await backfillAlias(
      queryRunner,
      "tenants",
      "quietHoursEnd",
      "quiet_hours_end",
    );
    await backfillAlias(queryRunner, "tenants", "bookingLink", "booking_link");
    await backfillAlias(queryRunner, "users", "tenantId", "tenant_id");
    await backfillAlias(queryRunner, "users", "passwordHash", "password_hash");
    await backfillAlias(queryRunner, "lead_events", "leadId", "lead_id");
    await backfillAlias(queryRunner, "messages", "leadId", "lead_id");
    await backfillAlias(
      queryRunner,
      "sequence_steps",
      "offsetMinutes",
      "offset_minutes",
    );
    await backfillAlias(
      queryRunner,
      "sequence_steps",
      "sequenceId",
      "sequence_id",
    );
    await backfillAlias(
      queryRunner,
      "sequence_enrollments",
      "sequenceId",
      "sequence_id",
    );
    await backfillAlias(
      queryRunner,
      "sequence_enrollments",
      "leadId",
      "lead_id",
    );
    await backfillAlias(
      queryRunner,
      "credentials",
      "encryptedValue",
      "encrypted_value",
    );
    await backfillAlias(queryRunner, "credentials", "tenantId", "tenant_id");
    await backfillAuditActors(queryRunner);

    if (addedByTable.get("users")?.has("isEmailVerified")) {
      await queryRunner.query(`
        UPDATE "users"
        SET "isEmailVerified" = true
        WHERE "passwordHash" IS NOT NULL
      `);
    }

    await dropLegacyNotNull(queryRunner, "tenants", "slug");
    await dropLegacyNotNull(queryRunner, "users", "name");
    await dropLegacyNotNull(queryRunner, "users", "tenant_id");
    await dropLegacyNotNull(queryRunner, "users", "password_hash");
    await dropLegacyNotNull(queryRunner, "credentials", "encrypted_value");
    await dropLegacyNotNull(queryRunner, "sequence_steps", "offset_minutes");

    await setNotNullWhenComplete(queryRunner, "users", "tenantId");
    await setNotNullWhenComplete(queryRunner, "credentials", "encryptedValue");
    await setNotNullWhenComplete(queryRunner, "messages", "leadId");

    for (const statement of indexStatements) {
      await queryRunner.query(statement);
    }
  }

  async down(): Promise<void> {
    // This reconciliation is intentionally irreversible. Dropping repaired
    // columns or customer workflow tables would destroy production data.
  }
}
