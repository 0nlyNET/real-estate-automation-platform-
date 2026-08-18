import { MigrationInterface, QueryRunner } from 'typeorm';

export class GoogleCalendarReliability1787011200001
  implements MigrationInterface
{
  name = 'GoogleCalendarReliability1787011200001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "calendar_connections" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "provider" varchar(30) NOT NULL DEFAULT 'google',
        "access_token_enc" text,
        "refresh_token_enc" text,
        "access_token_expires_at" timestamptz,
        "refresh_token_expires_at" timestamptz,
        "granted_scopes" text,
        "status" varchar(30) NOT NULL DEFAULT 'configured',
        "selected_calendar_id" text,
        "selected_calendar_name" varchar(255),
        "selected_calendar_time_zone" varchar(100),
        "webhook_channel_id" varchar(120),
        "webhook_resource_id" text,
        "webhook_token_hash" char(64),
        "webhook_expires_at" timestamptz,
        "webhook_last_message_number" varchar(40),
        "last_tested_at" timestamptz,
        "last_successful_sync_at" timestamptz,
        "last_error_code" varchar(100),
        "last_error_at" timestamptz,
        "disconnected_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_calendar_connection_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "webhook_channel_id" varchar(120)`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "webhook_resource_id" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "webhook_token_hash" char(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "webhook_expires_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "webhook_last_message_number" varchar(40)`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_calendar_connection_tenant_provider"
      ON "calendar_connections" ("tenant_id", "provider")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_calendar_connection_status"
      ON "calendar_connections" ("status", "last_tested_at")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_calendar_connection_webhook_channel"
      ON "calendar_connections" ("webhook_channel_id")
      WHERE "webhook_channel_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_calendar_connection_webhook_expiry"
      ON "calendar_connections" ("provider", "webhook_expires_at")
      WHERE "webhook_channel_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "calendar_oauth_states" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "state_hash" char(64) NOT NULL,
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "code_verifier_enc" text NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_calendar_oauth_state_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_calendar_oauth_state_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_calendar_oauth_state_hash"
      ON "calendar_oauth_states" ("state_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_calendar_oauth_state_expiry"
      ON "calendar_oauth_states" ("expires_at", "consumed_at")
    `);

    if (await queryRunner.hasTable('appointments')) {
      await queryRunner.query(
        `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "external_event_etag" text`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "external_provider" varchar(30)`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "external_calendar_id" text`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(160)`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "sync_status" varchar(30) NOT NULL DEFAULT 'not_synced'`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "last_synced_at" timestamptz`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "sync_error_code" varchar(100)`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "post_commit_completed_at" timestamptz`,
      );
      await queryRunner.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "IDX_appointment_idempotency"
        ON "appointments" ("tenant_id", "idempotency_key")
        WHERE "idempotency_key" IS NOT NULL
      `);
      await queryRunner.query(`
        UPDATE "appointments"
        SET "sync_status" = 'not_synced',
            "external_provider" = NULL,
            "external_calendar_id" = NULL,
            "external_event_etag" = NULL,
            "last_synced_at" = NULL
        WHERE "external_provider" IS NULL
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('appointments')) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_appointment_idempotency"`);
      await queryRunner.query(
        `ALTER TABLE "appointments" DROP COLUMN IF EXISTS "post_commit_completed_at"`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" DROP COLUMN IF EXISTS "sync_error_code"`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" DROP COLUMN IF EXISTS "last_synced_at"`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" DROP COLUMN IF EXISTS "sync_status"`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" DROP COLUMN IF EXISTS "idempotency_key"`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" DROP COLUMN IF EXISTS "external_provider"`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" DROP COLUMN IF EXISTS "external_calendar_id"`,
      );
      await queryRunner.query(
        `ALTER TABLE "appointments" DROP COLUMN IF EXISTS "external_event_etag"`,
      );
    }
    await queryRunner.query(`DROP TABLE IF EXISTS "calendar_oauth_states"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "calendar_connections"`);
  }
}
