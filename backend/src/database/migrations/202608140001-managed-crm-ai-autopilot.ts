import { MigrationInterface, QueryRunner } from 'typeorm';

export class ManagedCrmAiAutopilot1786665600001 implements MigrationInterface {
  name = 'ManagedCrmAiAutopilot1786665600001';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tenant_messaging_resources ADD COLUMN IF NOT EXISTS a2p_input_hash varchar(64) NULL`);
    await q.query(`ALTER TABLE workspace_ai_settings ADD COLUMN IF NOT EXISTS ai_first_responder_enabled boolean NOT NULL DEFAULT true`);
    await q.query(`ALTER TABLE workspace_ai_settings ADD COLUMN IF NOT EXISTS allowed_channels varchar NOT NULL DEFAULT 'sms,email'`);
    await q.query(`ALTER TABLE workspace_ai_settings ADD COLUMN IF NOT EXISTS tone varchar(40) NOT NULL DEFAULT 'professional_warm'`);
    await q.query(`ALTER TABLE workspace_ai_settings ADD COLUMN IF NOT EXISTS booking_behavior varchar(40) NOT NULL DEFAULT 'verified_link_only'`);
    await q.query(`
      CREATE TABLE IF NOT EXISTS account_invitations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash varchar(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz NULL,
        revoked_at timestamptz NULL,
        sent_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_account_invitations_token_hash" ON account_invitations(token_hash)`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_account_invitations_tenant_user" ON account_invitations(tenant_id, user_id)`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_account_invitations_active" ON account_invitations(tenant_id, user_id) WHERE used_at IS NULL AND revoked_at IS NULL`);

    for (const statement of [
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS ingestion_provider varchar(40) NULL`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_system varchar(80) NULL`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS original_source varchar(160) NULL`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS external_lead_id varchar(255) NULL`,
    ]) await q.query(statement);
    await q.query(`DROP INDEX IF EXISTS "IDX_leads_tenant_email"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_leads_tenant_phone"`);
    await q.query(`CREATE UNIQUE INDEX "IDX_leads_tenant_email" ON leads(tenant_id, email) WHERE email IS NOT NULL AND test_run_id IS NULL`);
    await q.query(`CREATE UNIQUE INDEX "IDX_leads_tenant_phone" ON leads(tenant_id, phone) WHERE phone IS NOT NULL AND test_run_id IS NULL`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_leads_tenant_test_run" ON leads(tenant_id, test_run_id) WHERE test_run_id IS NOT NULL`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_leads_tenant_source_system" ON leads(tenant_id, source_system) WHERE source_system IS NOT NULL`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS tenant_integration_connections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        provider varchar(40) NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'active',
        public_identifier varchar(32) NOT NULL,
        secret_hash varchar(64) NOT NULL,
        secret_last4 varchar(4) NOT NULL,
        configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
        capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
        last_used_at timestamptz NULL,
        last_tested_at timestamptz NULL,
        last_error text NULL,
        revoked_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tenant_integration_connection_public_id" ON tenant_integration_connections(public_identifier)`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_tenant_integration_connection_tenant_provider" ON tenant_integration_connections(tenant_id, provider)`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS integration_ingress_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        connection_id uuid NOT NULL REFERENCES tenant_integration_connections(id) ON DELETE CASCADE,
        external_event_id varchar(255) NOT NULL,
        lead_id uuid NULL REFERENCES leads(id) ON DELETE SET NULL,
        status varchar(30) NOT NULL DEFAULT 'processing',
        attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
        failure_reason text NULL,
        processed_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_integration_ingress_event_external" ON integration_ingress_events(connection_id, external_event_id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_integration_ingress_event_tenant" ON integration_ingress_events(tenant_id, created_at)`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS tenant_webhook_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event_type varchar(80) NOT NULL,
        target_url varchar(2048) NOT NULL,
        encrypted_signing_secret text NOT NULL,
        secret_last4 varchar(4) NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'active',
        failure_count integer NOT NULL DEFAULT 0,
        last_success_at timestamptz NULL,
        last_failure_at timestamptz NULL,
        last_error text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_tenant_webhook_subscription_event" ON tenant_webhook_subscriptions(tenant_id, event_type, status)`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS integration_delivery_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        subscription_id uuid NOT NULL REFERENCES tenant_webhook_subscriptions(id) ON DELETE CASCADE,
        event_id uuid NOT NULL,
        event_type varchar(80) NOT NULL,
        payload jsonb NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'scheduled',
        attempt_count integer NOT NULL DEFAULT 0,
        last_http_status integer NULL,
        last_error text NULL,
        delivered_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_integration_delivery_event_subscription_event" ON integration_delivery_events(subscription_id, event_id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_integration_delivery_event_tenant_status" ON integration_delivery_events(tenant_id, status)`);

    await q.query(`ALTER TABLE ai_runs ALTER COLUMN triggering_message_id DROP NOT NULL`);
    await q.query(`ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS trigger_type varchar(30) NOT NULL DEFAULT 'inbound'`);
    await q.query(`DROP INDEX IF EXISTS "IDX_ai_runs_triggering_message"`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ai_runs_triggering_message" ON ai_runs(triggering_message_id) WHERE triggering_message_id IS NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ai_runs_first_response" ON ai_runs(lead_id, trigger_type) WHERE trigger_type = 'first_response'`);

    await q.query(`
      CREATE TABLE IF NOT EXISTS assistant_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assistant_type varchar(30) NOT NULL,
        input_digest varchar(64) NOT NULL,
        prompt_preview varchar(240) NOT NULL,
        status varchar(30) NOT NULL,
        provider varchar(80) NULL,
        model varchar(120) NULL,
        response text NULL,
        requested_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
        executed_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
        blocked_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
        input_usage integer NOT NULL DEFAULT 0,
        output_usage integer NOT NULL DEFAULT 0,
        estimated_cost_usd double precision NULL,
        latency_ms integer NULL,
        error_code varchar(80) NULL,
        sanitized_error text NULL,
        confirmed_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_assistant_runs_tenant_type_created" ON assistant_runs(tenant_id, assistant_type, created_at)`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_assistant_runs_status" ON assistant_runs(status, created_at)`);

    await q.query(`ALTER TABLE platform_ai_controls ADD COLUMN IF NOT EXISTS provider_last_tested_at timestamptz NULL`);
    await q.query(`ALTER TABLE platform_ai_controls ADD COLUMN IF NOT EXISTS provider_test_model varchar(120) NULL`);
    await q.query(`ALTER TABLE platform_ai_controls ADD COLUMN IF NOT EXISTS provider_test_error text NULL`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE platform_ai_controls DROP COLUMN IF EXISTS provider_test_error`);
    await q.query(`ALTER TABLE platform_ai_controls DROP COLUMN IF EXISTS provider_test_model`);
    await q.query(`ALTER TABLE platform_ai_controls DROP COLUMN IF EXISTS provider_last_tested_at`);
    await q.query(`DROP TABLE IF EXISTS assistant_runs`);
    await q.query(`DROP INDEX IF EXISTS "UQ_ai_runs_first_response"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_ai_runs_triggering_message"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_ai_runs_triggering_message"`);
    await q.query(`UPDATE messages SET ai_run_id = NULL WHERE ai_run_id IN (SELECT id FROM ai_runs WHERE triggering_message_id IS NULL)`);
    await q.query(`DELETE FROM ai_runs WHERE triggering_message_id IS NULL`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_runs_triggering_message" ON ai_runs(triggering_message_id) WHERE triggering_message_id IS NOT NULL`);
    await q.query(`ALTER TABLE ai_runs DROP COLUMN IF EXISTS trigger_type`);
    await q.query(`ALTER TABLE ai_runs ALTER COLUMN triggering_message_id SET NOT NULL`);
    await q.query(`DROP TABLE IF EXISTS integration_delivery_events`);
    await q.query(`DROP TABLE IF EXISTS tenant_webhook_subscriptions`);
    await q.query(`DROP TABLE IF EXISTS integration_ingress_events`);
    await q.query(`DROP TABLE IF EXISTS tenant_integration_connections`);
    await q.query(`DROP INDEX IF EXISTS "IDX_leads_tenant_test_run"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_leads_tenant_source_system"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_leads_tenant_email"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_leads_tenant_phone"`);
    await q.query(`DELETE FROM leads WHERE test_run_id IS NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX "IDX_leads_tenant_email" ON leads(tenant_id, email) WHERE email IS NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX "IDX_leads_tenant_phone" ON leads(tenant_id, phone) WHERE phone IS NOT NULL`);
    await q.query(`ALTER TABLE leads DROP COLUMN IF EXISTS external_lead_id`);
    await q.query(`ALTER TABLE leads DROP COLUMN IF EXISTS original_source`);
    await q.query(`ALTER TABLE leads DROP COLUMN IF EXISTS source_system`);
    await q.query(`ALTER TABLE leads DROP COLUMN IF EXISTS ingestion_provider`);
    await q.query(`DROP TABLE IF EXISTS account_invitations`);
    await q.query(`ALTER TABLE workspace_ai_settings DROP COLUMN IF EXISTS booking_behavior`);
    await q.query(`ALTER TABLE workspace_ai_settings DROP COLUMN IF EXISTS tone`);
    await q.query(`ALTER TABLE workspace_ai_settings DROP COLUMN IF EXISTS allowed_channels`);
    await q.query(`ALTER TABLE workspace_ai_settings DROP COLUMN IF EXISTS ai_first_responder_enabled`);
    await q.query(`ALTER TABLE tenant_messaging_resources DROP COLUMN IF EXISTS a2p_input_hash`);
  }
}
