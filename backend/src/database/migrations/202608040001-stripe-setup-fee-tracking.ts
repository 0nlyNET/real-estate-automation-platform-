import { MigrationInterface, QueryRunner } from 'typeorm';

export class StripeSetupFeeTracking1785801600001
  implements MigrationInterface
{
  name = 'StripeSetupFeeTracking1785801600001';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "setup_paid_at" timestamptz',
    );
    await q.query(
      'ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "setup_invoice_id" text',
    );
    await q.query(
      'ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "setup_stripe_price_id" text',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'ALTER TABLE "tenants" DROP COLUMN IF EXISTS "setup_stripe_price_id"',
    );
    await q.query(
      'ALTER TABLE "tenants" DROP COLUMN IF EXISTS "setup_invoice_id"',
    );
    await q.query(
      'ALTER TABLE "tenants" DROP COLUMN IF EXISTS "setup_paid_at"',
    );
  }
}
