import { MigrationInterface, QueryRunner } from 'typeorm';

export class TurnkeyLaunchOperation1786579200001
  implements MigrationInterface
{
  name = 'TurnkeyLaunchOperation1786579200001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS durable_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        task_type varchar NOT NULL,
        tenant_id uuid NULL REFERENCES tenants(id) ON DELETE CASCADE,
        dedupe_key varchar NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        status varchar NOT NULL DEFAULT 'scheduled',
        next_run_at timestamptz NOT NULL,
        attempt_count integer NOT NULL DEFAULT 0,
        max_attempts integer NOT NULL DEFAULT 12,
        lease_owner varchar NULL,
        lease_expires_at timestamptz NULL,
        last_error text NULL,
        completed_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_durable_jobs_due" ON durable_jobs(status, next_run_at)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_durable_jobs_dedupe" ON durable_jobs(dedupe_key) WHERE dedupe_key IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS test_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        started_by_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        status varchar NOT NULL DEFAULT 'running',
        sms_recipient varchar NULL,
        email_recipient varchar NULL,
        test_lead_id uuid NULL,
        checks jsonb NOT NULL DEFAULT '{}'::jsonb,
        expires_at timestamptz NOT NULL,
        failure_reason text NULL,
        completed_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_test_runs_tenant_status" ON test_runs(tenant_id, status)`,
    );
    await queryRunner.query(
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS test_run_id uuid NULL REFERENCES test_runs(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE test_runs ADD CONSTRAINT test_runs_test_lead_id_fk FOREIGN KEY (test_lead_id) REFERENCES leads(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_leads_test_run_id" ON leads(test_run_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS offboarding_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        status varchar NOT NULL DEFAULT 'scheduled',
        reason text NOT NULL,
        requested_by_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
        retention_days integer NOT NULL,
        delete_after timestamptz NOT NULL,
        export_generated_at timestamptz NULL,
        started_at timestamptz NULL,
        completed_at timestamptz NULL,
        last_error text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_offboarding_tenant" UNIQUE(tenant_id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS send_decisions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        automation_id uuid NULL REFERENCES sequences(id) ON DELETE SET NULL,
        enrollment_id uuid NULL REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
        step_index integer NULL,
        template_version integer NULL,
        usage_reservation_id uuid NULL REFERENCES usage_reservations(id) ON DELETE SET NULL,
        lead_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        configuration_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        safety_decision jsonb NOT NULL DEFAULT '{}'::jsonb,
        usage_decision jsonb NOT NULL DEFAULT '{}'::jsonb,
        provider_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
        decision varchar NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_send_decisions_message" UNIQUE(message_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_send_decisions_tenant_created" ON send_decisions(tenant_id, created_at)`,
    );

    await queryRunner.query(
      `ALTER TABLE prospect_applications ADD COLUMN IF NOT EXISTS converted_tenant_id uuid NULL REFERENCES tenants(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE prospect_applications ADD COLUMN IF NOT EXISTS conversion_status varchar NOT NULL DEFAULT 'not_started'`,
    );
    await queryRunner.query(
      `ALTER TABLE prospect_applications ADD COLUMN IF NOT EXISTS converted_at timestamptz NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE prospect_applications ADD COLUMN IF NOT EXISTS conversion_error text NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_prospect_applications_converted_tenant_id" ON prospect_applications(converted_tenant_id) WHERE converted_tenant_id IS NOT NULL`,
    );

    for (const statement of [
      `ALTER TABLE tenant_messaging_resources ADD COLUMN IF NOT EXISTS a2p_trust_product_sid varchar NULL`,
      `ALTER TABLE tenant_messaging_resources ADD COLUMN IF NOT EXISTS a2p_provider_status varchar NULL`,
      `ALTER TABLE tenant_messaging_resources ADD COLUMN IF NOT EXISTS a2p_rejection_reason text NULL`,
      `ALTER TABLE tenant_messaging_resources ADD COLUMN IF NOT EXISTS a2p_last_checked_at timestamptz NULL`,
      `ALTER TABLE tenant_messaging_resources ADD COLUMN IF NOT EXISTS a2p_next_poll_at timestamptz NULL`,
      `ALTER TABLE tenant_email_identities ADD COLUMN IF NOT EXISTS custom_domain varchar NULL`,
      `ALTER TABLE tenant_email_identities ADD COLUMN IF NOT EXISTS sendgrid_subuser_id varchar NULL`,
      `ALTER TABLE tenant_email_identities ADD COLUMN IF NOT EXISTS domain_verification_status varchar NOT NULL DEFAULT 'platform_authenticated'`,
    ]) {
      await queryRunner.query(statement);
    }

    // Preserve each tenant's domain while assigning a deterministic unique
    // local-part. The tenant id suffix safely repairs historical collisions.
    const identities: Array<{ tenant_id: string; from_email: string }> =
      await queryRunner.query(
        `SELECT tenant_id, from_email FROM tenant_email_identities`,
      );
    for (const identity of identities) {
      const domain = identity.from_email.split('@')[1];
      if (!domain) continue;
      await queryRunner.query(
        `UPDATE tenant_email_identities SET from_email = $1 WHERE tenant_id = $2`,
        [`client-${identity.tenant_id}@${domain}`, identity.tenant_id],
      );
    }
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_email_identities_from_email" ON tenant_email_identities(from_email)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_tenant_email_identities_from_email"`);
    await queryRunner.query(`ALTER TABLE tenant_email_identities DROP COLUMN IF EXISTS domain_verification_status`);
    await queryRunner.query(`ALTER TABLE tenant_email_identities DROP COLUMN IF EXISTS sendgrid_subuser_id`);
    await queryRunner.query(`ALTER TABLE tenant_email_identities DROP COLUMN IF EXISTS custom_domain`);
    await queryRunner.query(`ALTER TABLE tenant_messaging_resources DROP COLUMN IF EXISTS a2p_next_poll_at`);
    await queryRunner.query(`ALTER TABLE tenant_messaging_resources DROP COLUMN IF EXISTS a2p_last_checked_at`);
    await queryRunner.query(`ALTER TABLE tenant_messaging_resources DROP COLUMN IF EXISTS a2p_rejection_reason`);
    await queryRunner.query(`ALTER TABLE tenant_messaging_resources DROP COLUMN IF EXISTS a2p_provider_status`);
    await queryRunner.query(`ALTER TABLE tenant_messaging_resources DROP COLUMN IF EXISTS a2p_trust_product_sid`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_prospect_applications_converted_tenant_id"`);
    await queryRunner.query(`ALTER TABLE prospect_applications DROP COLUMN IF EXISTS conversion_error`);
    await queryRunner.query(`ALTER TABLE prospect_applications DROP COLUMN IF EXISTS converted_at`);
    await queryRunner.query(`ALTER TABLE prospect_applications DROP COLUMN IF EXISTS conversion_status`);
    await queryRunner.query(`ALTER TABLE prospect_applications DROP COLUMN IF EXISTS converted_tenant_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS send_decisions`);
    await queryRunner.query(`DROP TABLE IF EXISTS offboarding_requests`);
    await queryRunner.query(`ALTER TABLE test_runs DROP CONSTRAINT IF EXISTS test_runs_test_lead_id_fk`);
    await queryRunner.query(`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_test_run_id_fk`);
    await queryRunner.query(`ALTER TABLE leads DROP COLUMN IF EXISTS test_run_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS test_runs`);
    await queryRunner.query(`DROP TABLE IF EXISTS durable_jobs`);
  }
}
