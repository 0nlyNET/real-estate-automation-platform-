import { MigrationInterface, QueryRunner } from 'typeorm';

export class LaunchSafeguards1786406400001 implements MigrationInterface {
  name = 'LaunchSafeguards1786406400001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
        ADD COLUMN IF NOT EXISTS "actor_type" varchar(30) NOT NULL DEFAULT 'user',
        ADD COLUMN IF NOT EXISTS "event_type" varchar(160) NOT NULL DEFAULT 'legacy.event',
        ADD COLUMN IF NOT EXISTS "resource_type" varchar(100),
        ADD COLUMN IF NOT EXISTS "resource_id" uuid,
        ADD COLUMN IF NOT EXISTS "before_state" jsonb,
        ADD COLUMN IF NOT EXISTS "after_state" jsonb,
        ADD COLUMN IF NOT EXISTS "ip_address" varchar(64)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_event_created"
      ON "audit_logs" ("event_type", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_resource_created"
      ON "audit_logs" ("resource_type", "resource_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "usage_policies" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "scope_type" varchar(20) NOT NULL,
        "scope_id" varchar(64) NOT NULL,
        "max_sms_per_hour" integer NOT NULL,
        "max_sms_per_day" integer NOT NULL,
        "max_emails_per_hour" integer NOT NULL,
        "max_emails_per_day" integer NOT NULL,
        "max_ai_calls_per_day" integer NOT NULL,
        "max_leads_per_hour" integer NOT NULL,
        "warning_percentage" integer NOT NULL DEFAULT 80,
        "warning_cost_threshold_usd" numeric(12,4) NOT NULL,
        "hard_cost_threshold_usd" numeric(12,4) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_usage_policy_scope" CHECK ("scope_type" IN ('tenant', 'platform')),
        CONSTRAINT "CK_usage_policy_warning_percentage" CHECK ("warning_percentage" BETWEEN 50 AND 99),
        CONSTRAINT "CK_usage_policy_positive_limits" CHECK (
          "max_sms_per_hour" > 0 AND
          "max_sms_per_day" > 0 AND
          "max_emails_per_hour" > 0 AND
          "max_emails_per_day" > 0 AND
          "max_ai_calls_per_day" > 0 AND
          "max_leads_per_hour" > 0 AND
          "warning_cost_threshold_usd" >= 0 AND
          "hard_cost_threshold_usd" > "warning_cost_threshold_usd"
        ),
        CONSTRAINT "UQ_usage_policy_scope" UNIQUE ("scope_type", "scope_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "usage_buckets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "scope_type" varchar(20) NOT NULL,
        "scope_id" varchar(64) NOT NULL,
        "metric" varchar(20) NOT NULL,
        "window_type" varchar(10) NOT NULL,
        "window_start" timestamptz NOT NULL,
        "quantity" integer NOT NULL DEFAULT 0,
        "estimated_cost_usd" numeric(12,4) NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_usage_bucket_scope" CHECK ("scope_type" IN ('tenant', 'platform')),
        CONSTRAINT "CK_usage_bucket_metric" CHECK ("metric" IN ('sms', 'email', 'ai', 'lead')),
        CONSTRAINT "CK_usage_bucket_window" CHECK ("window_type" IN ('hour', 'day')),
        CONSTRAINT "UQ_usage_bucket_scope_metric_window"
          UNIQUE ("scope_type", "scope_id", "metric", "window_type", "window_start")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_usage_bucket_scope_window"
      ON "usage_buckets" ("scope_type", "scope_id", "window_start")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "usage_reservations" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
        "idempotency_key" varchar(255) NOT NULL,
        "metric" varchar(20) NOT NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "estimated_cost_usd" numeric(12,4) NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_usage_reservation_metric" CHECK ("metric" IN ('sms', 'email', 'ai', 'lead')),
        CONSTRAINT "UQ_usage_reservation_idempotency" UNIQUE ("idempotency_key")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_usage_reservation_tenant_created"
      ON "usage_reservations" ("tenant_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      INSERT INTO "usage_policies" (
        "scope_type", "scope_id", "max_sms_per_hour", "max_sms_per_day",
        "max_emails_per_hour", "max_emails_per_day", "max_ai_calls_per_day",
        "max_leads_per_hour", "warning_percentage",
        "warning_cost_threshold_usd", "hard_cost_threshold_usd"
      ) VALUES ('platform', 'platform', 600, 5000, 1200, 10000, 2000, 1000, 80, 200, 250)
      ON CONFLICT ("scope_type", "scope_id") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "usage_policies" (
        "scope_type", "scope_id", "max_sms_per_hour", "max_sms_per_day",
        "max_emails_per_hour", "max_emails_per_day", "max_ai_calls_per_day",
        "max_leads_per_hour", "warning_percentage",
        "warning_cost_threshold_usd", "hard_cost_threshold_usd"
      )
      SELECT 'tenant', tenant.id::text, 60, 500, 120, 1000, 200, 100, 80, 20, 30
      FROM "tenants" tenant
      ON CONFLICT ("scope_type", "scope_id") DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "usage_reservations"');
    await queryRunner.query('DROP TABLE IF EXISTS "usage_buckets"');
    await queryRunner.query('DROP TABLE IF EXISTS "usage_policies"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_audit_logs_resource_created"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_audit_logs_event_created"');
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
        DROP COLUMN IF EXISTS "ip_address",
        DROP COLUMN IF EXISTS "after_state",
        DROP COLUMN IF EXISTS "before_state",
        DROP COLUMN IF EXISTS "resource_id",
        DROP COLUMN IF EXISTS "resource_type",
        DROP COLUMN IF EXISTS "event_type",
        DROP COLUMN IF EXISTS "actor_type"
    `);
  }
}
