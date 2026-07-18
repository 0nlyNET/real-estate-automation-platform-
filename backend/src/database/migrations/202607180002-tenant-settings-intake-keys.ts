import { MigrationInterface, QueryRunner } from "typeorm";

const columns: Array<{ name: string; sql: string }> = [
  { name: "created_at", sql: "timestamp NOT NULL DEFAULT now()" },
  { name: "updated_at", sql: "timestamp NOT NULL DEFAULT now()" },
  { name: "tenant_id", sql: "varchar" },
  {
    name: "time_zone",
    sql: "varchar NOT NULL DEFAULT 'America/New_York'",
  },
  {
    name: "quiet_hours_start",
    sql: "varchar NOT NULL DEFAULT '21:00'",
  },
  {
    name: "quiet_hours_end",
    sql: "varchar NOT NULL DEFAULT '08:00'",
  },
  { name: "booking_link", sql: "varchar" },
  { name: "automations_enabled", sql: "boolean NOT NULL DEFAULT true" },
  { name: "round_robin_enabled", sql: "boolean NOT NULL DEFAULT false" },
  { name: "round_robin_team_id", sql: "varchar" },
  { name: "round_robin_last_user_id", sql: "varchar" },
  { name: "zapier_api_key_hash", sql: "varchar" },
  { name: "zapier_api_key_last4", sql: "varchar" },
  { name: "intake_api_key_hash", sql: "varchar" },
  { name: "intake_api_key_last4", sql: "varchar" },
  { name: "intake_api_key_rotated_at", sql: "timestamptz" },
  { name: "webhook_url", sql: "varchar" },
  { name: "webhook_events", sql: "text" },
  { name: "facebook_connected", sql: "boolean NOT NULL DEFAULT false" },
  { name: "facebook_page_name", sql: "varchar" },
  { name: "facebook_form_id", sql: "varchar" },
  { name: "twilio_account_sid", sql: "varchar" },
  { name: "twilio_auth_token_enc", sql: "varchar" },
  { name: "twilio_from_number", sql: "varchar" },
  { name: "twilio_messaging_service_sid", sql: "varchar" },
  { name: "sendgrid_api_key_enc", sql: "varchar" },
  { name: "sendgrid_from_email", sql: "varchar" },
  { name: "sendgrid_from_name", sql: "varchar" },
  { name: "lead_source", sql: "varchar" },
  { name: "lead_source_other_label", sql: "varchar" },
];

export class TenantSettingsIntakeKeys1784332800002 implements MigrationInterface {
  name = "TenantSettingsIntakeKeys1784332800002";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenant_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        ${columns.map((column) => `"${column.name}" ${column.sql}`).join(",\n")},
        PRIMARY KEY ("id")
      )
    `);

    for (const column of columns) {
      await queryRunner.query(
        `ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "${column.name}" ${column.sql}`,
      );
    }

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenant_settings_tenant_id"
      ON "tenant_settings" ("tenant_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "credentials" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "provider" varchar NOT NULL,
        "encryptedValue" text NOT NULL,
        "tenantId" uuid,
        PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now()',
    );
    await queryRunner.query(
      'ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now()',
    );
    await queryRunner.query(
      'ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "provider" varchar',
    );
    await queryRunner.query(
      'ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "encryptedValue" text',
    );
    await queryRunner.query(
      'ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "tenantId" uuid',
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_credentials_tenant_provider"
      ON "credentials" ("tenantId", "provider")
    `);
  }

  async down(): Promise<void> {
    // Key metadata and tenant settings are retained on rollback to avoid
    // silently breaking connected lead forms.
  }
}
