import { MigrationInterface, QueryRunner } from 'typeorm';

async function addConstraint(queryRunner: QueryRunner, sql: string) {
  await queryRunner.query(sql).catch((error: any) => {
    if (String(error?.code || '') !== '42710') throw error;
  });
}

export class ClientTodayWorkflow1784592000001 implements MigrationInterface {
  name = 'ClientTodayWorkflow1784592000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leads"
        ADD COLUMN IF NOT EXISTS "temperature_reason" text NOT NULL DEFAULT 'Needs more qualification before the next step.',
        ADD COLUMN IF NOT EXISTS "readiness_level" varchar NOT NULL DEFAULT 'exploring',
        ADD COLUMN IF NOT EXISTS "main_blocker" varchar,
        ADD COLUMN IF NOT EXISTS "next_milestone" varchar,
        ADD COLUMN IF NOT EXISTS "recommended_next_action" varchar,
        ADD COLUMN IF NOT EXISTS "follow_up_cadence" varchar,
        ADD COLUMN IF NOT EXISTS "qualification_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "conversation_summary" text,
        ADD COLUMN IF NOT EXISTS "recommended_talking_points" text,
        ADD COLUMN IF NOT EXISTS "outcome" varchar
    `);
    await queryRunner.query(`
      UPDATE "leads"
      SET "temperature_reason" = CASE
        WHEN "temperature" = 'hot' THEN 'Previously marked hot; review qualification notes for context.'
        WHEN "temperature" = 'cold' THEN 'Previously marked cold; review qualification notes for context.'
        ELSE 'Needs more qualification before the next step.'
      END
      WHERE "temperature_reason" IS NULL OR "temperature_reason" = ''
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lead_handoffs" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        lead_id uuid NOT NULL,
        assigned_user_id uuid,
        priority varchar(20) NOT NULL DEFAULT 'high',
        status varchar(20) NOT NULL DEFAULT 'open',
        reason text NOT NULL,
        summary text NOT NULL,
        recommended_action varchar(255) NOT NULL,
        latest_context text,
        due_at timestamptz,
        snoozed_until timestamptz,
        opened_at timestamptz,
        completed_at timestamptz,
        completion_note text,
        admin_escalated_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "appointments" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        lead_id uuid NOT NULL,
        assigned_user_id uuid,
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'scheduled',
        source varchar(30) NOT NULL DEFAULT 'manual',
        calendar_source varchar(80) NOT NULL DEFAULT 'RealtyTechAI',
        confirmation_status varchar(30) NOT NULL DEFAULT 'pending',
        follow_up_status varchar(30) NOT NULL DEFAULT 'not_due',
        notes text,
        external_event_id varchar(255),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lead_handoff_tenant_status_due" ON "lead_handoffs" (tenant_id, status, due_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lead_handoff_assignee_status_due" ON "lead_handoffs" (assigned_user_id, status, due_at)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lead_handoff_one_active" ON "lead_handoffs" (lead_id) WHERE status IN ('open', 'opened', 'snoozed')`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_appointment_tenant_status_start" ON "appointments" (tenant_id, status, starts_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_appointment_assignee_status_start" ON "appointments" (assigned_user_id, status, starts_at)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_appointment_external_event" ON "appointments" (tenant_id, external_event_id) WHERE external_event_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_leads_today_followup" ON "leads" (tenant_id, next_follow_up_at) WHERE next_follow_up_at IS NOT NULL`,
    );

    await addConstraint(
      queryRunner,
      `ALTER TABLE "lead_handoffs" ADD CONSTRAINT "FK_lead_handoff_tenant" FOREIGN KEY (tenant_id) REFERENCES "tenants"(id) ON DELETE CASCADE`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "lead_handoffs" ADD CONSTRAINT "FK_lead_handoff_lead" FOREIGN KEY (lead_id) REFERENCES "leads"(id) ON DELETE CASCADE`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "lead_handoffs" ADD CONSTRAINT "FK_lead_handoff_assignee" FOREIGN KEY (assigned_user_id) REFERENCES "users"(id) ON DELETE SET NULL`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_appointment_tenant" FOREIGN KEY (tenant_id) REFERENCES "tenants"(id) ON DELETE CASCADE`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_appointment_lead" FOREIGN KEY (lead_id) REFERENCES "leads"(id) ON DELETE CASCADE`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "appointments" ADD CONSTRAINT "FK_appointment_assignee" FOREIGN KEY (assigned_user_id) REFERENCES "users"(id) ON DELETE SET NULL`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "appointments" ADD CONSTRAINT "CHK_appointment_time_order" CHECK (ends_at > starts_at)`,
    );
  }

  async down(): Promise<void> {
    // Intentionally non-destructive. Handoffs and appointments are business records;
    // rollback requires a reviewed data-preserving migration.
  }
}
