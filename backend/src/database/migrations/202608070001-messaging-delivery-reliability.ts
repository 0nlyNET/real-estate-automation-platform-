import { MigrationInterface, QueryRunner } from 'typeorm';

export class MessagingDeliveryReliability1786060800001
  implements MigrationInterface
{
  name = 'MessagingDeliveryReliability1786060800001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "messages"
        ADD COLUMN IF NOT EXISTS "subject" varchar(500),
        ADD COLUMN IF NOT EXISTS "in_reply_to_provider_message_id" varchar(500)
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sendgrid_webhook_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "provider_event_id" varchar(255) NOT NULL,
        "tenant_id" uuid,
        "message_id" uuid,
        "event_type" varchar(50) NOT NULL,
        "provider_message_id" varchar(500),
        "occurred_at" timestamptz,
        "processing_result" varchar(50) NOT NULL,
        "payload_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT "FK_sendgrid_event_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_sendgrid_event_message"
          FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sendgrid_webhook_event_id"
      ON "sendgrid_webhook_events" ("provider_event_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sendgrid_webhook_message_created"
      ON "sendgrid_webhook_events" ("message_id", "created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "sendgrid_webhook_events"');
    await queryRunner.query(`
      ALTER TABLE "messages"
        DROP COLUMN IF EXISTS "in_reply_to_provider_message_id",
        DROP COLUMN IF EXISTS "subject"
    `);
  }
}
