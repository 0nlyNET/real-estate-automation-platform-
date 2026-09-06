import { MigrationInterface, QueryRunner } from 'typeorm';

export class FirstClientPayment1788652800001 implements MigrationInterface {
  name = 'FirstClientPayment1788652800001';

  async up(queryRunner: QueryRunner) {
    await queryRunner.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_confirmed_at timestamptz');
    await queryRunner.query('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paid_subscription_id text');
    await queryRunner.query("ALTER TABLE workspace_ai_settings ALTER COLUMN response_mode SET DEFAULT 'controlled_autopilot'");
    await queryRunner.query('ALTER TABLE workspace_ai_settings ALTER COLUMN maximum_automatic_turns SET DEFAULT 12');
    // Existing accounts must reconcile against Stripe; an old active flag is not payment evidence.
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query("ALTER TABLE workspace_ai_settings ALTER COLUMN response_mode SET DEFAULT 'human_only'");
    await queryRunner.query('ALTER TABLE workspace_ai_settings ALTER COLUMN maximum_automatic_turns SET DEFAULT 6');
    // Keep payment evidence during rollback; older releases ignore these additive columns.
  }
}
