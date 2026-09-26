import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds email delivery tracking columns to admin_notifications, mirroring the
 * existing push delivery columns. NotificationsService now delivers an email
 * channel (via the platform MailService/SendGrid) in addition to in-app and
 * web push; these columns record per-notification email delivery state.
 *
 * Idempotent: columns are added only if they do not already exist.
 */
export class NotificationEmailDelivery1790361600001
  implements MigrationInterface
{
  name = "NotificationEmailDelivery1790361600001";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE admin_notifications
        ADD COLUMN IF NOT EXISTS email_delivery_status varchar(30) NOT NULL DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS email_sent_at timestamptz NULL,
        ADD COLUMN IF NOT EXISTS email_attempt_count int NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE admin_notifications
        DROP COLUMN IF EXISTS email_delivery_status,
        DROP COLUMN IF EXISTS email_sent_at,
        DROP COLUMN IF EXISTS email_attempt_count
    `);
  }
}
