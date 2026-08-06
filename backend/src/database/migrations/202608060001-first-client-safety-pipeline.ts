import { MigrationInterface, QueryRunner } from "typeorm";

export class FirstClientSafetyPipeline1785974400001 implements MigrationInterface {
  name = "FirstClientSafetyPipeline1785974400001";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "credentials"
        ADD COLUMN IF NOT EXISTS "ingestion_key_hash" varchar(64)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_credentials_provider_ingestion_key_hash"
      ON "credentials" ("provider", "ingestion_key_hash")
      WHERE "ingestion_key_hash" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tenant_settings_intake_key_hash"
      ON "tenant_settings" ("intake_api_key_hash")
      WHERE "intake_api_key_hash" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "leads"
        ADD COLUMN IF NOT EXISTS "provider" varchar(30),
        ADD COLUMN IF NOT EXISTS "provider_lead_id" varchar(255),
        ADD COLUMN IF NOT EXISTS "ingestion_fingerprint" varchar(64),
        ADD COLUMN IF NOT EXISTS "communication_status" varchar(30) NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS "opted_out_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "opt_out_source" varchar(100),
        ADD COLUMN IF NOT EXISTS "sms_eligible" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "email_eligible" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      UPDATE "leads"
      SET "sms_eligible" = true
      WHERE "phone" IS NOT NULL
        AND "phone" <> ''
    `);
    await queryRunner.query(`
      UPDATE "leads"
      SET "email_eligible" = true
      WHERE "email" IS NOT NULL
        AND "email" <> ''
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_leads_tenant_provider_lead"
      ON "leads" ("tenant_id", "provider", "provider_lead_id")
      WHERE "provider_lead_id" IS NOT NULL AND "provider" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_leads_tenant_communication_status"
      ON "leads" ("tenant_id", "communication_status")
    `);

    await queryRunner.query(`
      ALTER TABLE "tenant_settings"
        ADD COLUMN IF NOT EXISTS "booking_link_verification_status" varchar(30) NOT NULL DEFAULT 'unverified',
        ADD COLUMN IF NOT EXISTS "booking_link_verification_expires_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "booking_link_revoked_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "time_zone_verified_at" timestamptz
    `);
    await queryRunner.query(`
      UPDATE "tenant_settings"
      SET "booking_link_verification_status" = 'verified',
          "booking_link_verification_expires_at" =
            "booking_link_verified_at" + interval '90 days'
      WHERE "booking_link_verified_at" IS NOT NULL
        AND "booking_link_revoked_at" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "messages"
        ADD COLUMN IF NOT EXISTS "communication_type" varchar(30),
        ADD COLUMN IF NOT EXISTS "requires_booking_link" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "job_purpose" varchar(50) NOT NULL DEFAULT 'ordinary',
        ADD COLUMN IF NOT EXISTS "blocked_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "blocked_reason" text,
        ADD COLUMN IF NOT EXISTS "blocked_reason_history" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "safety_rule_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "cancellation_reason" text,
        ADD COLUMN IF NOT EXISTS "provider_submission_started_at" timestamptz
    `);
    await queryRunner.query(`
      UPDATE "messages"
      SET "communication_type" = "channel"
      WHERE "communication_type" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "messages"
      ALTER COLUMN "communication_type" SET DEFAULT 'sms',
      ALTER COLUMN "communication_type" SET NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_messages_safety_dispatch"
      ON "messages" ("status", "scheduled_at", "next_attempt_at")
      WHERE "direction" = 'outbound'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lead_ingestion_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "provider" varchar(30) NOT NULL,
        "provider_lead_id" varchar(255),
        "idempotency_key" varchar(100) NOT NULL,
        "ingestion_fingerprint" varchar(64) NOT NULL,
        "status" varchar(30) NOT NULL,
        "validation_error" text,
        "correlation_id" varchar(100) NOT NULL,
        "payload_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "lead_id" uuid,
        "provider_received_at" timestamptz NOT NULL,
        "processed_at" timestamptz NOT NULL,
        CONSTRAINT "FK_lead_ingestion_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_lead_ingestion_lead"
          FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lead_ingestion_tenant_provider_key"
      ON "lead_ingestion_events" ("tenant_id", "provider", "idempotency_key")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lead_ingestion_tenant_created"
      ON "lead_ingestion_events" ("tenant_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "twilio_inbound_messages" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "tenant_id" uuid NOT NULL,
        "lead_id" uuid,
        "message_sid" varchar(64) NOT NULL,
        "messaging_service_sid" varchar(64),
        "from_number" varchar(20) NOT NULL,
        "to_number" varchar(20) NOT NULL,
        "body" text NOT NULL,
        "normalized_body" text NOT NULL,
        "opt_out_type" varchar(50),
        "is_opt_out" boolean NOT NULL DEFAULT false,
        "processing_result" varchar(50) NOT NULL,
        "processed_at" timestamptz NOT NULL,
        CONSTRAINT "FK_twilio_inbound_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_twilio_inbound_lead"
          FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_twilio_inbound_tenant_message_sid"
      ON "twilio_inbound_messages" ("tenant_id", "message_sid")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_twilio_inbound_tenant_from_created"
      ON "twilio_inbound_messages" ("tenant_id", "from_number", "created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "twilio_inbound_messages"');
    await queryRunner.query('DROP TABLE IF EXISTS "lead_ingestion_events"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_messages_safety_dispatch"',
    );
    await queryRunner.query(`
      ALTER TABLE "messages"
        DROP COLUMN IF EXISTS "provider_submission_started_at",
        DROP COLUMN IF EXISTS "cancellation_reason",
        DROP COLUMN IF EXISTS "safety_rule_ids",
        DROP COLUMN IF EXISTS "blocked_reason_history",
        DROP COLUMN IF EXISTS "blocked_reason",
        DROP COLUMN IF EXISTS "blocked_at",
        DROP COLUMN IF EXISTS "job_purpose",
        DROP COLUMN IF EXISTS "requires_booking_link",
        DROP COLUMN IF EXISTS "communication_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "tenant_settings"
        DROP COLUMN IF EXISTS "time_zone_verified_at",
        DROP COLUMN IF EXISTS "booking_link_revoked_at",
        DROP COLUMN IF EXISTS "booking_link_verification_expires_at",
        DROP COLUMN IF EXISTS "booking_link_verification_status"
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_leads_tenant_communication_status"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_leads_tenant_provider_lead"',
    );
    await queryRunner.query(`
      ALTER TABLE "leads"
        DROP COLUMN IF EXISTS "email_eligible",
        DROP COLUMN IF EXISTS "sms_eligible",
        DROP COLUMN IF EXISTS "opt_out_source",
        DROP COLUMN IF EXISTS "opted_out_at",
        DROP COLUMN IF EXISTS "communication_status",
        DROP COLUMN IF EXISTS "ingestion_fingerprint",
        DROP COLUMN IF EXISTS "provider_lead_id",
        DROP COLUMN IF EXISTS "provider"
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_tenant_settings_intake_key_hash"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_credentials_provider_ingestion_key_hash"',
    );
    await queryRunner.query(`
      ALTER TABLE "credentials" DROP COLUMN IF EXISTS "ingestion_key_hash"
    `);
  }
}
