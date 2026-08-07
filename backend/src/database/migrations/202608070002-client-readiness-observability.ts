import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClientReadinessObservability1786060800002
  implements MigrationInterface
{
  name = 'ClientReadinessObservability1786060800002';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "onboarding_records"
        ADD COLUMN IF NOT EXISTS "inbound_email_tested_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "configuration_updated_at" timestamptz NOT NULL DEFAULT now()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "onboarding_records"
        DROP COLUMN IF EXISTS "configuration_updated_at",
        DROP COLUMN IF EXISTS "inbound_email_tested_at"
    `);
  }
}
