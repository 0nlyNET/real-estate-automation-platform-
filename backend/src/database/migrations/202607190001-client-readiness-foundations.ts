import { MigrationInterface, QueryRunner } from 'typeorm';

type IntegrityIssue = { relation: string; issue_count: number | string };

async function assertCleanForConstraints(queryRunner: QueryRunner) {
  const orphanChecks = [
    ['users.tenantId -> tenants.id', '"users"', '"tenantId"', '"tenants"'],
    ['leads.tenant_id -> tenants.id', '"leads"', '"tenant_id"', '"tenants"'],
    ['messages.leadId -> leads.id', '"messages"', '"leadId"', '"leads"'],
    ['sequences.tenant_id -> tenants.id', '"sequences"', '"tenant_id"', '"tenants"'],
    ['sequence_enrollments.leadId -> leads.id', '"sequence_enrollments"', '"leadId"', '"leads"'],
    ['sequence_enrollments.sequenceId -> sequences.id', '"sequence_enrollments"', '"sequenceId"', '"sequences"'],
    ['sequence_steps.sequenceId -> sequences.id', '"sequence_steps"', '"sequenceId"', '"sequences"'],
    ['credentials.tenantId -> tenants.id', '"credentials"', '"tenantId"', '"tenants"'],
    ['support_tickets.tenantId -> tenants.id', '"support_tickets"', '"tenantId"', '"tenants"'],
  ] as const;
  const issues: IntegrityIssue[] = [];
  for (const [relation, childTable, childColumn, parentTable] of orphanChecks) {
    const rows: Array<{ issue_count: number | string }> = await queryRunner.query(
      `SELECT COUNT(*)::int AS issue_count
         FROM ${childTable} child
         LEFT JOIN ${parentTable} parent ON parent.id = child.${childColumn}
        WHERE child.${childColumn} IS NOT NULL AND parent.id IS NULL`,
    );
    if (Number(rows[0]?.issue_count || 0) > 0) {
      issues.push({ relation, issue_count: rows[0].issue_count });
    }
  }

  const requiredTenantChecks = [
    ['sequences missing tenant_id', '"sequences"', '"tenant_id"'],
    [
      'sequence_enrollments missing tenant_id',
      '"sequence_enrollments"',
      '"tenant_id"',
    ],
    ['credentials missing tenantId', '"credentials"', '"tenantId"'],
  ] as const;
  for (const [relation, table, column] of requiredTenantChecks) {
    const rows: Array<{ issue_count: number | string }> =
      await queryRunner.query(
        `SELECT COUNT(*)::int AS issue_count FROM ${table} WHERE ${column} IS NULL`,
      );
    if (Number(rows[0]?.issue_count || 0) > 0) {
      issues.push({ relation, issue_count: rows[0].issue_count });
    }
  }

  const duplicateCredentials: Array<{ issue_count: number | string }> =
    await queryRunner.query(`
      SELECT COUNT(*)::int AS issue_count
      FROM "credentials"
      WHERE "tenantId" IS NOT NULL
      GROUP BY "tenantId", provider
    `);
  const credentialDuplicateCount = duplicateCredentials.reduce(
    (sum, row) => sum + Math.max(0, Number(row.issue_count) - 1),
    0,
  );
  if (credentialDuplicateCount) {
    issues.push({
      relation: 'duplicate tenant/provider credentials',
      issue_count: credentialDuplicateCount,
    });
  }

  const duplicateEnrollments: Array<{ issue_count: number | string }> =
    await queryRunner.query(`
      SELECT COUNT(*)::int AS issue_count
      FROM "sequence_enrollments"
      WHERE status IN ('active', 'paused')
      GROUP BY "sequenceId", "leadId"
    `);
  const enrollmentDuplicateCount = duplicateEnrollments.reduce(
    (sum, row) => sum + Math.max(0, Number(row.issue_count) - 1),
    0,
  );
  if (enrollmentDuplicateCount) {
    issues.push({
      relation: 'duplicate active sequence enrollments',
      issue_count: enrollmentDuplicateCount,
    });
  }

  if (issues.length) {
    const details = issues
      .map((issue) => `${issue.relation}=${Number(issue.issue_count)}`)
      .join(', ');
    throw new Error(
      `Client-readiness integrity preflight failed. No rows were deleted. Resolve the documented records and rerun the migration: ${details}`,
    );
  }
}

async function addConstraint(queryRunner: QueryRunner, sql: string) {
  await queryRunner.query(sql);
}

export class ClientReadinessFoundations1784419200001
  implements MigrationInterface
{
  name = 'ClientReadinessFoundations1784419200001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenants"
        ADD COLUMN IF NOT EXISTS "lifecycle_status" text NOT NULL DEFAULT 'ONBOARDING',
        ADD COLUMN IF NOT EXISTS "service_activated_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "service_paused_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "trial_start" timestamptz,
        ADD COLUMN IF NOT EXISTS "current_period_start" timestamptz,
        ADD COLUMN IF NOT EXISTS "stripe_product_id" text,
        ADD COLUMN IF NOT EXISTS "cancellation_date" timestamptz,
        ADD COLUMN IF NOT EXISTS "canceled_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "latest_invoice_id" text,
        ADD COLUMN IF NOT EXISTS "last_payment_failure_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "billing_state_updated_at" timestamptz
        ,ADD COLUMN IF NOT EXISTS "stripe_checkout_session_id" text
        ,ADD COLUMN IF NOT EXISTS "stripe_checkout_started_at" timestamptz
    `);
    await queryRunner.query(
      `ALTER TABLE "tenants" ALTER COLUMN "status" SET DEFAULT 'incomplete'`,
    );

    await queryRunner.query(`
      ALTER TABLE "tenant_settings"
        ALTER COLUMN "automations_enabled" SET DEFAULT false
    `);
    await queryRunner.query(`
      UPDATE "tenant_settings"
      SET "automations_enabled" = false
      WHERE "automations_enabled" = true
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "session_version" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "password_changed_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "welcome_email_sent_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "last_login_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "createdAt" timestamp NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updatedAt" timestamp NOT NULL DEFAULT now()
    `);

    await queryRunner.query(`
      ALTER TABLE "messages"
        ADD COLUMN IF NOT EXISTS "provider_status" varchar,
        ADD COLUMN IF NOT EXISTS "provider_accepted_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "delivered_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "failed_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "canceled_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "error_code" varchar,
        ADD COLUMN IF NOT EXISTS "sanitized_error_message" text,
        ADD COLUMN IF NOT EXISTS "idempotency_key" varchar,
        ADD COLUMN IF NOT EXISTS "locked_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "locked_by" varchar,
        ADD COLUMN IF NOT EXISTS "last_attempted_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamptz
    `);
    await queryRunner.query(`
      UPDATE "messages"
      SET "idempotency_key" = 'legacy:' || id::text
      WHERE "idempotency_key" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "messages"
      SET status = 'queued'
      WHERE status IN ('pending', 'scheduled')
    `);
    await queryRunner.query(`
      ALTER TABLE "messages"
        ALTER COLUMN "idempotency_key" SET DEFAULT gen_random_uuid()::text,
        ALTER COLUMN "idempotency_key" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "sequence_enrollments"
        ADD COLUMN IF NOT EXISTS "tenant_id" uuid,
        ADD COLUMN IF NOT EXISTS "locked_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "locked_by" varchar
    `);
    await queryRunner.query(`
      UPDATE "sequence_enrollments"
      SET "tenant_id" = "leads"."tenant_id"
      FROM "leads"
      WHERE "sequence_enrollments"."tenant_id" IS NULL
        AND "sequence_enrollments"."leadId" = "leads".id
    `);

    await queryRunner.query(`
      ALTER TABLE "sequence_steps"
        ADD COLUMN IF NOT EXISTS "approval_status" varchar NOT NULL DEFAULT 'draft',
        ADD COLUMN IF NOT EXISTS "approved_by_user_id" uuid,
        ADD COLUMN IF NOT EXISTS "approved_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "template_version" integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "identity_label" varchar,
        ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      ALTER TABLE "support_tickets"
        ADD COLUMN IF NOT EXISTS "severity" varchar(30) NOT NULL DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS "assigned_operator_id" uuid,
        ADD COLUMN IF NOT EXISTS "due_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "acknowledged_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "resolved_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "resolution_note" text
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "prospect_applications" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL,
        email varchar(255) NOT NULL,
        phone varchar(50),
        company varchar(255),
        website varchar(500),
        estimated_monthly_lead_volume integer,
        requested_service varchar(120),
        message text NOT NULL,
        source varchar(255) NOT NULL DEFAULT 'website',
        status varchar(50) NOT NULL DEFAULT 'new',
        assigned_operator_id uuid,
        operator_notes text,
        notification_status varchar(50) NOT NULL DEFAULT 'pending',
        notification_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        stripe_event_id varchar(255) NOT NULL,
        event_type varchar(255) NOT NULL,
        api_version varchar(50),
        stripe_created_at timestamptz,
        processing_status varchar(30) NOT NULL DEFAULT 'received',
        processing_started_at timestamptz,
        processing_completed_at timestamptz,
        error_summary text,
        tenant_id uuid,
        stripe_customer_id varchar,
        stripe_subscription_id varchar,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "onboarding_records" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        business_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
        contacts jsonb NOT NULL DEFAULT '{}'::jsonb,
        service_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
        lead_handling jsonb NOT NULL DEFAULT '{}'::jsonb,
        brand_communication jsonb NOT NULL DEFAULT '{}'::jsonb,
        consent_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
        integration_configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
        provider_tests jsonb NOT NULL DEFAULT '{}'::jsonb,
        verified_items jsonb NOT NULL DEFAULT '{}'::jsonb,
        sms_enabled boolean NOT NULL DEFAULT false,
        email_enabled boolean NOT NULL DEFAULT false,
        booking_enabled boolean NOT NULL DEFAULT false,
        consent_policy_acknowledged_at timestamptz,
        test_lead_completed_at timestamptz,
        inbound_sms_tested_at timestamptz,
        stop_tested_at timestamptz,
        provider_rejection_tested_at timestamptz,
        billing_verified_at timestamptz,
        client_approved_at timestamptz,
        client_approval_evidence text,
        operator_approved_by_id uuid,
        operator_approved_at timestamptz,
        activation_status varchar(40) NOT NULL DEFAULT 'incomplete',
        blocked_reason text,
        target_launch_date date,
        assigned_onboarding_owner_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "operations_tasks" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid,
        application_id uuid,
        category varchar(80) NOT NULL,
        title varchar(255) NOT NULL,
        description text NOT NULL,
        priority varchar(20) NOT NULL DEFAULT 'normal',
        status varchar(30) NOT NULL DEFAULT 'open',
        assigned_operator_id uuid,
        due_at timestamptz,
        completed_at timestamptz,
        evidence_note text,
        related_entity_type varchar(80),
        related_entity_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lead_consent_records" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        lead_id uuid NOT NULL,
        channel varchar(20) NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'unknown',
        source varchar(255),
        disclosure_text text,
        disclosure_version varchar(100),
        consented_at timestamptz,
        capture_url varchar(1000),
        source_identifier varchar(255),
        capture_ip varchar(64),
        imported_by_user_id uuid,
        client_attested boolean NOT NULL DEFAULT false,
        revoked_at timestamptz,
        revocation_source varchar(255),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lead_stage_events" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        lead_id uuid NOT NULL,
        previous_stage varchar,
        new_stage varchar NOT NULL,
        changed_by_user_id uuid,
        change_source varchar NOT NULL DEFAULT 'application',
        note text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await assertCleanForConstraints(queryRunner);

    await queryRunner.query(`
      ALTER TABLE "sequence_enrollments"
      ALTER COLUMN "tenant_id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "sequences"
      ALTER COLUMN "tenant_id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "credentials"
      ALTER COLUMN "tenantId" SET NOT NULL
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_messages_idempotency_key" ON "messages" ("idempotency_key")`,
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_messages_claimable"
      ON "messages" (status, "next_attempt_at", "scheduled_at", "created_at")
      WHERE direction = 'outbound' AND status IN ('queued', 'sending')
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_messages_provider_status" ON "messages" ("provider_message_id", "provider_status")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_active_enrollment_unique"
      ON "sequence_enrollments" ("sequenceId", "leadId")
      WHERE status IN ('active', 'paused')
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_enrollment_claimable" ON "sequence_enrollments" (status, "next_run_at", "locked_at")`,
    );
    // Earlier releases used this name for a non-unique lookup index. Rebuild it
    // only after the duplicate-data preflight so one provider row per tenant is enforced.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_credentials_tenant_provider"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_credentials_tenant_provider" ON "credentials" ("tenantId", provider)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_stripe_event_id" ON "stripe_webhook_events" (stripe_event_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_stripe_event_status" ON "stripe_webhook_events" (processing_status, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_status_created" ON "prospect_applications" (status, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_applications_email" ON "prospect_applications" (email)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_onboarding_tenant" ON "onboarding_records" (tenant_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_operations_queue" ON "operations_tasks" (status, priority, due_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_operations_tenant_status" ON "operations_tasks" (tenant_id, status)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lead_consent_channel" ON "lead_consent_records" (lead_id, channel)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lead_consent_tenant_status" ON "lead_consent_records" (tenant_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_stage_events_tenant_created" ON "lead_stage_events" (tenant_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_stage_events_lead_created" ON "lead_stage_events" (lead_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_support_queue" ON "support_tickets" (status, severity, due_at)`,
    );

    await addConstraint(
      queryRunner,
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_tenant_readiness" FOREIGN KEY ("tenantId") REFERENCES "tenants"(id) ON DELETE CASCADE`,
    ).catch((error: any) => {
      if (String(error?.code || '') !== '42710') throw error;
    });
    await addConstraint(
      queryRunner,
      `ALTER TABLE "leads" ADD CONSTRAINT "FK_leads_tenant_readiness" FOREIGN KEY ("tenant_id") REFERENCES "tenants"(id) ON DELETE CASCADE`,
    ).catch((error: any) => {
      if (String(error?.code || '') !== '42710') throw error;
    });
    await addConstraint(
      queryRunner,
      `ALTER TABLE "messages" ADD CONSTRAINT "FK_messages_lead_readiness" FOREIGN KEY ("leadId") REFERENCES "leads"(id) ON DELETE CASCADE`,
    ).catch((error: any) => {
      if (String(error?.code || '') !== '42710') throw error;
    });
    await addConstraint(
      queryRunner,
      `ALTER TABLE "sequences" ADD CONSTRAINT "FK_sequences_tenant_readiness" FOREIGN KEY (tenant_id) REFERENCES "tenants"(id) ON DELETE CASCADE`,
    ).catch((error: any) => {
      if (String(error?.code || '') !== '42710') throw error;
    });
    await addConstraint(
      queryRunner,
      `ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "FK_enrollments_lead_readiness" FOREIGN KEY ("leadId") REFERENCES "leads"(id) ON DELETE CASCADE`,
    ).catch((error: any) => {
      if (String(error?.code || '') !== '42710') throw error;
    });
    await addConstraint(
      queryRunner,
      `ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "FK_enrollments_sequence_readiness" FOREIGN KEY ("sequenceId") REFERENCES "sequences"(id) ON DELETE CASCADE`,
    ).catch((error: any) => {
      if (String(error?.code || '') !== '42710') throw error;
    });
    await addConstraint(
      queryRunner,
      `ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "FK_enrollments_tenant_readiness" FOREIGN KEY (tenant_id) REFERENCES "tenants"(id) ON DELETE CASCADE`,
    ).catch((error: any) => {
      if (String(error?.code || '') !== '42710') throw error;
    });
    await addConstraint(
      queryRunner,
      `ALTER TABLE "sequence_steps" ADD CONSTRAINT "FK_sequence_steps_sequence_readiness" FOREIGN KEY ("sequenceId") REFERENCES "sequences"(id) ON DELETE CASCADE`,
    ).catch((error: any) => {
      if (String(error?.code || '') !== '42710') throw error;
    });
    await addConstraint(
      queryRunner,
      `ALTER TABLE "credentials" ADD CONSTRAINT "FK_credentials_tenant_readiness" FOREIGN KEY ("tenantId") REFERENCES "tenants"(id) ON DELETE CASCADE`,
    ).catch((error: any) => {
      if (String(error?.code || '') !== '42710') throw error;
    });
    await addConstraint(
      queryRunner,
      `ALTER TABLE "support_tickets" ADD CONSTRAINT "FK_support_tenant_readiness" FOREIGN KEY ("tenantId") REFERENCES "tenants"(id) ON DELETE CASCADE`,
    ).catch((error: any) => {
      if (String(error?.code || '') !== '42710') throw error;
    });
    await addConstraint(
      queryRunner,
      `ALTER TABLE "onboarding_records" ADD CONSTRAINT "FK_onboarding_tenant" FOREIGN KEY (tenant_id) REFERENCES "tenants"(id) ON DELETE CASCADE`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "operations_tasks" ADD CONSTRAINT "FK_operations_tenant" FOREIGN KEY (tenant_id) REFERENCES "tenants"(id) ON DELETE CASCADE`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "operations_tasks" ADD CONSTRAINT "FK_operations_application" FOREIGN KEY (application_id) REFERENCES "prospect_applications"(id) ON DELETE SET NULL`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "lead_consent_records" ADD CONSTRAINT "FK_consent_tenant" FOREIGN KEY (tenant_id) REFERENCES "tenants"(id) ON DELETE CASCADE`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "lead_consent_records" ADD CONSTRAINT "FK_consent_lead" FOREIGN KEY (lead_id) REFERENCES "leads"(id) ON DELETE CASCADE`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "lead_stage_events" ADD CONSTRAINT "FK_stage_event_tenant" FOREIGN KEY (tenant_id) REFERENCES "tenants"(id) ON DELETE CASCADE`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "lead_stage_events" ADD CONSTRAINT "FK_stage_event_lead" FOREIGN KEY (lead_id) REFERENCES "leads"(id) ON DELETE CASCADE`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "stripe_webhook_events" ADD CONSTRAINT "FK_stripe_event_tenant" FOREIGN KEY (tenant_id) REFERENCES "tenants"(id) ON DELETE SET NULL`,
    );
  }

  async down(): Promise<void> {
    // Intentionally non-destructive. Removing these columns/tables would erase
    // consent, billing-event, onboarding, and operational audit evidence.
  }
}
