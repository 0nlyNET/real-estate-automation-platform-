import { MigrationInterface, QueryRunner } from 'typeorm';

export class ControlledAiLeadAgent1784937600001
  implements MigrationInterface
{
  name = 'ControlledAiLeadAgent1784937600001';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "workspace_ai_settings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "ai_enabled" boolean NOT NULL DEFAULT false,
        "response_mode" varchar(30) NOT NULL DEFAULT 'human_only',
        "identity_label" varchar(160),
        "maximum_automatic_turns" integer NOT NULL DEFAULT 6,
        "minimum_confidence_threshold" double precision NOT NULL DEFAULT 0.82,
        "allowed_topics" text,
        "escalation_rules" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "per_conversation_usage_limit" integer NOT NULL DEFAULT 12000,
        "monthly_workspace_usage_limit" integer NOT NULL DEFAULT 500000,
        "ai_paused" boolean NOT NULL DEFAULT false,
        "ai_paused_reason" text,
        "configuration_approval_status" varchar(20) NOT NULL DEFAULT 'draft',
        "configuration_approved_at" timestamptz,
        "configuration_approved_by_id" uuid,
        "last_configuration_update" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_workspace_ai_response_mode"
          CHECK ("response_mode" IN ('human_only', 'draft', 'controlled_autopilot')),
        CONSTRAINT "CHK_workspace_ai_approval"
          CHECK ("configuration_approval_status" IN ('draft', 'approved')),
        CONSTRAINT "CHK_workspace_ai_turns"
          CHECK ("maximum_automatic_turns" BETWEEN 1 AND 25),
        CONSTRAINT "CHK_workspace_ai_confidence"
          CHECK ("minimum_confidence_threshold" BETWEEN 0.5 AND 1),
        CONSTRAINT "FK_workspace_ai_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);
    await q.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_workspace_ai_settings_tenant" ON "workspace_ai_settings" ("tenant_id")',
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "brokerage_ai_knowledge" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "public_name" varchar(160),
        "office_email" varchar(255),
        "office_phone" varchar(40),
        "service_areas" text,
        "business_hours" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "scheduling_instructions" text,
        "approved_faqs" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "escalation_instructions" text,
        "qualification_questions" text,
        "prohibited_topics" text,
        "agent_roster" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "routing_rules" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "required_disclaimer" text,
        "approval_status" varchar(20) NOT NULL DEFAULT 'draft',
        "approved_at" timestamptz,
        "approved_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_brokerage_ai_approval"
          CHECK ("approval_status" IN ('draft', 'approved')),
        CONSTRAINT "FK_brokerage_ai_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
      )
    `);
    await q.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_brokerage_ai_knowledge_tenant" ON "brokerage_ai_knowledge" ("tenant_id")',
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "conversation_ai_states" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "lead_id" uuid NOT NULL,
        "ownership_status" varchar(30) NOT NULL DEFAULT 'human_handling',
        "ai_turn_count" integer NOT NULL DEFAULT 0,
        "usage_units" integer NOT NULL DEFAULT 0,
        "last_inbound_message_id_processed" uuid,
        "last_ai_response_id" uuid,
        "taken_over_by_user_id" uuid,
        "taken_over_at" timestamptz,
        "returned_to_ai_at" timestamptz,
        "escalation_reason" text,
        "ai_paused_reason" text,
        "version" integer NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_conversation_ai_ownership"
          CHECK ("ownership_status" IN (
            'ai_handling',
            'human_handling',
            'waiting_for_human',
            'paused',
            'closed'
          )),
        CONSTRAINT "FK_conversation_ai_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_conversation_ai_lead"
          FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE
      )
    `);
    await q.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_conversation_ai_tenant_lead" ON "conversation_ai_states" ("tenant_id", "lead_id")',
    );
    await q.query(
      'CREATE INDEX IF NOT EXISTS "IDX_conversation_ai_tenant_status" ON "conversation_ai_states" ("tenant_id", "ownership_status")',
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_runs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "lead_id" uuid NOT NULL,
        "triggering_message_id" uuid NOT NULL,
        "provider" varchar(80) NOT NULL DEFAULT 'openai',
        "model" varchar(120),
        "mode" varchar(30) NOT NULL,
        "status" varchar(30) NOT NULL DEFAULT 'queued',
        "confidence" double precision,
        "prompt_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "structured_response" jsonb,
        "requested_tools" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "executed_tools" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "blocked_tools" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "input_usage" integer NOT NULL DEFAULT 0,
        "output_usage" integer NOT NULL DEFAULT 0,
        "estimated_cost_usd" double precision,
        "latency_ms" integer,
        "error_code" varchar(80),
        "sanitized_error" text,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "locked_at" timestamptz,
        "locked_by" varchar(160),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_ai_runs_mode"
          CHECK ("mode" IN ('human_only', 'draft', 'controlled_autopilot')),
        CONSTRAINT "CHK_ai_runs_status"
          CHECK ("status" IN (
            'queued',
            'processing',
            'drafted',
            'response_queued',
            'completed',
            'blocked',
            'failed'
          )),
        CONSTRAINT "FK_ai_runs_tenant"
          FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_runs_lead"
          FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ai_runs_trigger_message"
          FOREIGN KEY ("triggering_message_id") REFERENCES "messages"("id") ON DELETE CASCADE
      )
    `);
    await q.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_runs_triggering_message" ON "ai_runs" ("triggering_message_id")',
    );
    await q.query(
      'CREATE INDEX IF NOT EXISTS "IDX_ai_runs_tenant_created" ON "ai_runs" ("tenant_id", "created_at")',
    );
    await q.query(
      'CREATE INDEX IF NOT EXISTS "IDX_ai_runs_status_created" ON "ai_runs" ("status", "created_at")',
    );

    await q.query(`
      CREATE TABLE IF NOT EXISTS "platform_ai_controls" (
        "id" varchar(40) PRIMARY KEY DEFAULT 'global',
        "paused" boolean NOT NULL DEFAULT false,
        "reason" text,
        "updated_by_id" uuid,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`
      INSERT INTO "platform_ai_controls" ("id", "paused")
      VALUES ('global', false)
      ON CONFLICT ("id") DO NOTHING
    `);

    await q.query(
      `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "authorship" varchar(20) NOT NULL DEFAULT 'system'`,
    );
    await q.query(
      'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "ai_run_id" uuid',
    );
    await q.query(
      'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "approved_by_user_id" uuid',
    );
    await q.query(
      'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "approved_at" timestamptz',
    );
    await q.query(
      'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "edited_at" timestamptz',
    );
    await q.query(`
      UPDATE "messages"
      SET "authorship" = CASE
        WHEN "idempotency_key" LIKE 'sequence:%' THEN 'template'
        WHEN "idempotency_key" LIKE 'manual:%' THEN 'human'
        ELSE "authorship"
      END
    `);
    await q.query(
      'CREATE INDEX IF NOT EXISTS "IDX_messages_ai_run_id" ON "messages" ("ai_run_id") WHERE "ai_run_id" IS NOT NULL',
    );
    await q.query(
      'CREATE INDEX IF NOT EXISTS "IDX_messages_lead_authorship_status" ON "messages" ("leadId", "authorship", "status")',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      'DROP INDEX IF EXISTS "IDX_messages_lead_authorship_status"',
    );
    await q.query('DROP INDEX IF EXISTS "IDX_messages_ai_run_id"');
    await q.query('ALTER TABLE "messages" DROP COLUMN IF EXISTS "edited_at"');
    await q.query(
      'ALTER TABLE "messages" DROP COLUMN IF EXISTS "approved_at"',
    );
    await q.query(
      'ALTER TABLE "messages" DROP COLUMN IF EXISTS "approved_by_user_id"',
    );
    await q.query('ALTER TABLE "messages" DROP COLUMN IF EXISTS "ai_run_id"');
    await q.query('ALTER TABLE "messages" DROP COLUMN IF EXISTS "authorship"');
    await q.query('DROP TABLE IF EXISTS "platform_ai_controls"');
    await q.query('DROP TABLE IF EXISTS "ai_runs"');
    await q.query('DROP TABLE IF EXISTS "conversation_ai_states"');
    await q.query('DROP TABLE IF EXISTS "brokerage_ai_knowledge"');
    await q.query('DROP TABLE IF EXISTS "workspace_ai_settings"');
  }
}
