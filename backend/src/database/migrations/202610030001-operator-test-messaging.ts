import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Operator test messaging authorization.
 * 
 * Creates:
 * 1. operator_test_authorizations table — server-created test grants
 * 2. messages.is_operator_test column — flags test sends for audit/exclusion
 * 3. operator_test_grant_usages table — transactional quota reservations
 * 
 * Tenant ownership for messages comes through leadId -> leads.tenantId.
 * There is NO tenant_id column on messages.
 * 
 * This does NOT modify billing state. It provides a narrow, audited exception
 * for operator testing without representing the tenant as a paid client.
 */
export class OperatorTestMessaging1740000000000 implements MigrationInterface {
  name = "OperatorTestMessaging1740000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Grant authorizations table
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
        revoked_at timestamptz NULL,
        revoked_by varchar(255) NULL,
        created_by varchar(255) NOT NULL,
        purpose text NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_operator_test_auth_tenant 
      ON operator_test_authorizations (tenant_id, is_revoked)
    `);

    // 2. Message flag column
    await queryRunner.query(`
      ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS is_operator_test boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS operator_test_grant_id uuid NULL
    `);
    // Valid index: is_operator_test is a real column on messages.
    // Tenant scoping is via leadId join; do NOT index a non-existent tenant_id.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_operator_test 
      ON messages (is_operator_test, created_at)
    `);

    // 3. Transactional quota reservations
    // Each reservation is keyed to (grant_id, message_id) for idempotency.
    // Retries reuse the same reservation; they do not create duplicates.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS operator_test_grant_usages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        grant_id uuid NOT NULL REFERENCES operator_test_authorizations(id) ON DELETE CASCADE,
        message_id uuid NOT NULL UNIQUE,
        tenant_id uuid NOT NULL,
        recipient_email varchar(255) NOT NULL,
        reserved_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_grant_message UNIQUE (grant_id, message_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_grant_usages_grant 
      ON operator_test_grant_usages (grant_id, reserved_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_grant_usages_tenant_day 
      ON operator_test_grant_usages (tenant_id, reserved_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_grant_usages_tenant_day`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_grant_usages_grant`);
    await queryRunner.query(`DROP TABLE IF EXISTS operator_test_grant_usages`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_messages_operator_test`);
    await queryRunner.query(`
      ALTER TABLE messages DROP COLUMN IF EXISTS operator_test_grant_id
    `);
    await queryRunner.query(`
      ALTER TABLE messages DROP COLUMN IF EXISTS is_operator_test
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_operator_test_auth_tenant`);
    await queryRunner.query(`DROP TABLE IF EXISTS operator_test_authorizations`);
  }
}
