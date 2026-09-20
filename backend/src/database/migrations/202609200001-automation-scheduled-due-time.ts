import { MigrationInterface, QueryRunner } from "typeorm";

export class AutomationScheduledDueTime1789862400001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ["durable_jobs", "sequence_enrollments"]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "scheduled_run_at" timestamptz`,
      );
      await queryRunner.query(
        `UPDATE "${table}" SET "scheduled_run_at" = "next_run_at" WHERE "scheduled_run_at" IS NULL`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ["sequence_enrollments", "durable_jobs"]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "scheduled_run_at"`,
      );
    }
  }
}
