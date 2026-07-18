import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditAndProviderRouting1784332800003
  implements MigrationInterface
{
  name = 'AuditAndProviderRouting1784332800003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "credentials"
      ADD COLUMN IF NOT EXISTS "routingKey" varchar
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_credentials_provider_routing_key"
      ON "credentials" ("provider", "routingKey")
      WHERE "routingKey" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "tenantId" uuid,
        "actorId" uuid,
        "actorEmail" varchar,
        "action" varchar NOT NULL DEFAULT 'unknown',
        "method" varchar NOT NULL DEFAULT 'UNKNOWN',
        "path" varchar NOT NULL DEFAULT '/',
        "statusCode" integer NOT NULL DEFAULT 200,
        "metadata" jsonb,
        PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      'ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "tenantId" uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actorId" uuid',
    );
    await queryRunner.query(
      'ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "actorEmail" varchar',
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "action" varchar NOT NULL DEFAULT 'unknown'`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "method" varchar NOT NULL DEFAULT 'UNKNOWN'`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "path" varchar NOT NULL DEFAULT '/'`,
    );
    await queryRunner.query(
      'ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "statusCode" integer NOT NULL DEFAULT 200',
    );
    await queryRunner.query(
      'ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "metadata" jsonb',
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_audit_logs_tenant_created"
      ON "audit_logs" ("tenantId", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit logs are immutable';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TRG_audit_logs_immutable" ON "audit_logs"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TRG_audit_logs_immutable"
      BEFORE UPDATE OR DELETE ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation()
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.messages') IS NOT NULL THEN
          WITH duplicates AS (
            SELECT "id", ROW_NUMBER() OVER (
              PARTITION BY "provider_message_id"
              ORDER BY "created_at" ASC, "id" ASC
            ) AS row_number
            FROM "messages"
            WHERE "provider_message_id" IS NOT NULL
          )
          UPDATE "messages" AS message
          SET "provider_message_id" = NULL
          FROM duplicates
          WHERE message."id" = duplicates."id"
            AND duplicates.row_number > 1;

          CREATE UNIQUE INDEX IF NOT EXISTS "IDX_messages_provider_message_id"
          ON "messages" ("provider_message_id")
          WHERE "provider_message_id" IS NOT NULL;
        END IF;
      END $$
    `);
  }

  async down(): Promise<void> {
    // Security and idempotency constraints are intentionally retained. Removing
    // them during rollback could make existing audit data mutable or duplicate
    // provider deliveries.
  }
}
