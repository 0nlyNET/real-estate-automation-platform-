import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Notification system v1: operational email templates, incident lifecycle,
 * bounded email retry, and digest preferences.
 *
 * - admin_notifications: template_id (rendered email template), provider_message_id
 *   (SendGrid message id), email_last_error (sanitized, max 500 chars),
 *   email_retry_at (next scheduled retry).
 * - notification_incidents: deduplicated incident tracking with failure
 *   counting, escalation, and single-recovery semantics.
 * - admin_notification_preferences: daily_digest_enabled (default true),
 *   weekly_digest_enabled (default false).
 *
 * Idempotent: columns/tables are added only if they do not already exist.
 */
export class NotificationSystemV11790365760000 implements MigrationInterface {
  name = "NotificationSystemV11790365760000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE admin_notifications
        ADD COLUMN IF NOT EXISTS template_id varchar(80) NULL,
        ADD COLUMN IF NOT EXISTS provider_message_id varchar(120) NULL,
        ADD COLUMN IF NOT EXISTS email_last_error varchar(500) NULL,
        ADD COLUMN IF NOT EXISTS email_retry_at timestamptz NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS notification_incidents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_key varchar(255) NOT NULL UNIQUE,
        status varchar(20) NOT NULL DEFAULT 'open',
        failure_count int NOT NULL DEFAULT 0,
        first_failure_at timestamptz NULL,
        last_failure_at timestamptz NULL,
        last_notified_severity varchar(20) NULL,
        last_notified_at timestamptz NULL,
        recovered_at timestamptz NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS IDX_notification_incidents_status
        ON notification_incidents (status)
    `);

    await queryRunner.query(`
      ALTER TABLE admin_notification_preferences
        ADD COLUMN IF NOT EXISTS daily_digest_enabled boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS weekly_digest_enabled boolean NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE admin_notification_preferences
        DROP COLUMN IF EXISTS daily_digest_enabled,
        DROP COLUMN IF EXISTS weekly_digest_enabled
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS notification_incidents`);
    await queryRunner.query(`
      ALTER TABLE admin_notifications
        DROP COLUMN IF EXISTS template_id,
        DROP COLUMN IF EXISTS provider_message_id,
        DROP COLUMN IF EXISTS email_last_error,
        DROP COLUMN IF EXISTS email_retry_at
    `);
  }
}
