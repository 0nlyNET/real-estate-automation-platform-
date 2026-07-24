import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClientExperienceReadiness1784851200001 implements MigrationInterface {
  name = 'ClientExperienceReadiness1784851200001';
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "booking_link_verified_at" timestamptz');
    await q.query('ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "intake_last_received_at" timestamptz');
    if (await q.hasTable('appointments')) {
      await q.query('ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "confirmation_task_created_at" timestamptz');
      await q.query('ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "reminder_status" varchar(30) NOT NULL DEFAULT \'scheduled\'');
      await q.query('ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamptz');
      await q.query('UPDATE "appointments" SET "reminder_status" = \'cancelled\' WHERE "status" IN (\'completed\', \'cancelled\', \'no_show\')');
    }
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE "appointments" DROP COLUMN IF EXISTS "reminder_sent_at"');
    await q.query('ALTER TABLE "appointments" DROP COLUMN IF EXISTS "reminder_status"');
    await q.query('ALTER TABLE "appointments" DROP COLUMN IF EXISTS "confirmation_task_created_at"');
    await q.query('ALTER TABLE "tenant_settings" DROP COLUMN IF EXISTS "intake_last_received_at"');
    await q.query('ALTER TABLE "tenant_settings" DROP COLUMN IF EXISTS "booking_link_verified_at"');
  }
}
