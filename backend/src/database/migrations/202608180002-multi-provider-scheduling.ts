import { MigrationInterface, QueryRunner } from 'typeorm';

export class MultiProviderScheduling1787011200002
  implements MigrationInterface
{
  name = 'MultiProviderScheduling1787011200002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "active_booking_provider" varchar(40)`,
    );
    await queryRunner.query(`
      ALTER TABLE "tenant_settings"
      ADD CONSTRAINT "CK_tenant_settings_active_booking_provider"
      CHECK (
        "active_booking_provider" IS NULL OR
        "active_booking_provider" IN ('google_calendar', 'microsoft_calendar', 'calendly')
      )
    `);

    await queryRunner.query(
      `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "provider_account_id" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "provider_tenant_id" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "selected_resource_type" varchar(50)`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "selected_resource_uri" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "selected_resource_metadata" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_connections" ADD COLUMN IF NOT EXISTS "webhook_secret_enc" text`,
    );
    await queryRunner.query(`
      ALTER TABLE "calendar_connections"
      ADD CONSTRAINT "CK_calendar_connection_provider"
      CHECK ("provider" IN ('google', 'microsoft', 'calendly'))
    `);
    await queryRunner.query(`
      UPDATE "calendar_connections"
      SET "selected_resource_type" = COALESCE("selected_resource_type", 'calendar'),
          "selected_resource_uri" = COALESCE("selected_resource_uri", "selected_calendar_id")
      WHERE "provider" = 'google' AND "selected_calendar_id" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "tenant_settings" AS "settings"
      SET "active_booking_provider" = 'google_calendar'
      WHERE "active_booking_provider" IS NULL
        AND EXISTS (
          SELECT 1
          FROM "calendar_connections" AS "connection"
          WHERE "connection"."tenant_id"::text = "settings"."tenant_id"
            AND "connection"."provider" = 'google'
            AND "connection"."status" = 'connected'
            AND "connection"."selected_calendar_id" IS NOT NULL
            AND "connection"."last_tested_at" IS NOT NULL
        )
    `);

    await queryRunner.query(
      `ALTER TABLE "calendar_oauth_states" ADD COLUMN IF NOT EXISTS "provider" varchar(30) NOT NULL DEFAULT 'google'`,
    );
    await queryRunner.query(`
      ALTER TABLE "calendar_oauth_states"
      ADD CONSTRAINT "CK_calendar_oauth_state_provider"
      CHECK ("provider" IN ('google', 'microsoft', 'calendly'))
    `);

    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "external_connection_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "external_invitee_id" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "external_join_url" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "external_cancel_url" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "external_reschedule_url" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "external_provider_updated_at" timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "meeting_mode" varchar(20) NOT NULL DEFAULT 'in_person'`,
    );
    await queryRunner.query(`
      ALTER TABLE "appointments"
      ADD CONSTRAINT "CK_appointment_external_provider"
      CHECK (
        "external_provider" IS NULL OR
        "external_provider" IN ('google', 'microsoft', 'calendly')
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "appointments"
      ADD CONSTRAINT "CK_appointment_meeting_mode"
      CHECK ("meeting_mode" IN ('in_person', 'phone', 'virtual'))
    `);
    await queryRunner.query(`
      ALTER TABLE "appointments"
      ADD CONSTRAINT "FK_appointment_external_connection"
      FOREIGN KEY ("external_connection_id")
      REFERENCES "calendar_connections"("id")
      ON DELETE SET NULL
    `);
    await queryRunner.query(`
      UPDATE "appointments"
      SET "external_provider" = 'google'
      WHERE "external_event_id" IS NOT NULL
        AND "external_provider" IS NULL
        AND "calendar_source" = 'Google Calendar'
    `);
    const providerConnections: Array<{
      id: string;
      tenant_id: string;
      provider: string;
    }> = await queryRunner.query(
      `SELECT "id", "tenant_id", "provider" FROM "calendar_connections"`,
    );
    for (const connection of providerConnections) {
      await queryRunner.query(
        `UPDATE "appointments"
         SET "external_connection_id" = $1
         WHERE "external_connection_id" IS NULL
           AND "tenant_id" = $2
           AND "external_provider" = $3`,
        [connection.id, connection.tenant_id, connection.provider],
      );
    }
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_appointment_external_event"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_appointment_external_event"
      ON "appointments" ("tenant_id", "external_provider", "external_event_id")
      WHERE "external_event_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_appointment_external_invitee"
      ON "appointments" ("tenant_id", "external_provider", "external_invitee_id")
      WHERE "external_invitee_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_appointment_external_connection"
      ON "appointments" ("external_connection_id", "sync_status")
      WHERE "external_connection_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "booking_webhook_receipts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "provider" varchar(30) NOT NULL,
        "event_key" varchar(255) NOT NULL,
        "payload_hash" char(64) NOT NULL,
        "received_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_booking_webhook_receipt_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_booking_webhook_receipt_provider"
          CHECK ("provider" IN ('google', 'microsoft', 'calendly'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_booking_webhook_provider_event"
      ON "booking_webhook_receipts" ("tenant_id", "provider", "event_key")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_booking_webhook_tenant_received"
      ON "booking_webhook_receipts" ("tenant_id", "received_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "booking_webhook_receipts"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_appointment_external_connection"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_appointment_external_invitee"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_appointment_external_event"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_appointment_external_event"
      ON "appointments" ("tenant_id", "external_event_id")
      WHERE "external_event_id" IS NOT NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "FK_appointment_external_connection"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "CK_appointment_meeting_mode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "appointments" DROP CONSTRAINT IF EXISTS "CK_appointment_external_provider"`,
    );
    for (const column of [
      'meeting_mode',
      'external_provider_updated_at',
      'external_reschedule_url',
      'external_cancel_url',
      'external_join_url',
      'external_invitee_id',
      'external_connection_id',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "appointments" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "calendar_oauth_states" DROP CONSTRAINT IF EXISTS "CK_calendar_oauth_state_provider"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_oauth_states" DROP COLUMN IF EXISTS "provider"`,
    );
    await queryRunner.query(
      `ALTER TABLE "calendar_connections" DROP CONSTRAINT IF EXISTS "CK_calendar_connection_provider"`,
    );
    for (const column of [
      'webhook_secret_enc',
      'selected_resource_metadata',
      'selected_resource_uri',
      'selected_resource_type',
      'provider_tenant_id',
      'provider_account_id',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "calendar_connections" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "tenant_settings" DROP CONSTRAINT IF EXISTS "CK_tenant_settings_active_booking_provider"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenant_settings" DROP COLUMN IF EXISTS "active_booking_provider"`,
    );
  }
}
