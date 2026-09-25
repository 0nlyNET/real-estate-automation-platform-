import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Re-labels prospect application notifications that "failed" only because the
 * platform email provider was never configured.
 *
 * Before this fix, submitInquiry() recorded notification_status = 'failed'
 * when MailService threw 'SENDGRID_API_KEY missing' / 'SENDGRID_FROM_EMAIL
 * missing', which the admin dashboard renders as a generic "Alert failed".
 * The new code records 'not_configured' in that case instead; this migration
 * repairs the historical rows whose notification_error contains exactly the
 * missing-config messages thrown by MailService.
 *
 * Conservative and idempotent:
 * - Only rows currently 'failed' whose error text matches the exact
 *   missing-config messages are touched; genuine send failures stay 'failed'.
 * - Re-running is a no-op (no row matches after the first run).
 */
export class ApplicationNotificationProviderState1790294400002
  implements MigrationInterface
{
  name = "ApplicationNotificationProviderState1790294400002";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE prospect_applications
      SET notification_status = 'not_configured',
          updated_at = now()
      WHERE notification_status = 'failed'
        AND (
          notification_error LIKE '%SENDGRID_API_KEY missing%'
          OR notification_error LIKE '%SENDGRID_FROM_EMAIL missing%'
        )
    `);
  }

  async down(): Promise<void> {
    // Intentionally irreversible: restoring 'failed' would reintroduce the
    // misleading label this migration removes.
  }
}
