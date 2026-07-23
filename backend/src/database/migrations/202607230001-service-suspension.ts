import { MigrationInterface, QueryRunner } from 'typeorm';

export class ServiceSuspension1784764800001 implements MigrationInterface {
  name = 'ServiceSuspension1784764800001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenants"
        ADD COLUMN IF NOT EXISTS "service_suspended_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "service_suspension_reason" text,
        ADD COLUMN IF NOT EXISTS "service_suspension_source" varchar(30),
        ADD COLUMN IF NOT EXISTS "service_suspended_by_id" uuid,
        ADD COLUMN IF NOT EXISTS "service_previous_lifecycle_status" varchar(40),
        ADD COLUMN IF NOT EXISTS "service_restored_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "service_restored_by_id" uuid
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tenant_service_suspension"
      ON "tenants" ("lifecycle_status", "service_suspended_at")
    `);
  }

  async down(): Promise<void> {
    // Suspension records are operational history. Rollback is intentionally non-destructive.
  }
}
