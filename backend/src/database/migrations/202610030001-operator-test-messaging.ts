import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Operator test messaging authorization.
 * 
 * Creates:
 * 1. operator_test_authorizations table — server-created test grants
 * 2. messages.is_operator_test column — flags test sends for audit/exclusion
 * 
 * This does NOT modify billing state. It provides a narrow, audited exception
 * for operator testing without representing the tenant as a paid client.
 */
export class OperatorTestMessaging1740000000000 implements MigrationInterface {
  name = "OperatorTestMessaging1740000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS operator_test_authorizations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        recipient_allowlist text[] NOT NULL,
        channel varchar(20) NOT NULL DEFAULT 'email',
        expires_at timestamptz NOT NULL,
        daily_limit int NOT NULL DEFAULT 10,
        total_limit int NOT NULL DEFAULT 50,
        is_revoked boolean NOT NULL DEFAULT false,
        created_by varchar(255) NOT NULL,
        purpose text NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_operator_test_auth_tenant 
      ON operator_test_authorizations (tenant_id, is_revoked)
    `);
    await queryRunner.query(`
      ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS is_operator_test boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_operator_test 
      ON messages (tenant_id, is_operator_test, created_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_messages_operator_test`);
    await queryRunner.query(`
      ALTER TABLE messages DROP COLUMN IF EXISTS is_operator_test
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_operator_test_auth_tenant`);
    await queryRunner.query(`DROP TABLE IF EXISTS operator_test_authorizations`);
  }
}
