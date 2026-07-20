import { MigrationInterface, QueryRunner } from 'typeorm';

async function addConstraint(queryRunner: QueryRunner, sql: string) {
  await queryRunner.query(sql).catch((error: any) => {
    if (String(error?.code || '') !== '42710') throw error;
  });
}

export class AdminOperationsNotifications1784505600001
  implements MigrationInterface
{
  name = 'AdminOperationsNotifications1784505600001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "platform_role" varchar(30)
    `);

    await queryRunner.query(`
      ALTER TABLE "tenants"
        ADD COLUMN IF NOT EXISTS "assigned_operator_id" uuid,
        ADD COLUMN IF NOT EXISTS "stripe_unit_amount" integer,
        ADD COLUMN IF NOT EXISTS "stripe_currency" varchar(3),
        ADD COLUMN IF NOT EXISTS "stripe_recurring_interval" varchar(10)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_notifications" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        recipient_user_id uuid NOT NULL,
        event_type varchar(120) NOT NULL,
        category varchar(40) NOT NULL,
        severity varchar(20) NOT NULL DEFAULT 'info',
        title varchar(180) NOT NULL,
        message text NOT NULL,
        action_url varchar(500),
        entity_type varchar(80),
        entity_id uuid,
        deduplication_key varchar(255) NOT NULL,
        incident_key varchar(255),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        read_at timestamptz,
        push_delivery_status varchar(30) NOT NULL DEFAULT 'pending',
        push_sent_at timestamptz,
        push_attempt_count integer NOT NULL DEFAULT 0,
        expires_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_push_subscriptions" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        recipient_user_id uuid NOT NULL,
        endpoint text NOT NULL,
        p256dh_key text NOT NULL,
        auth_key text NOT NULL,
        device_label varchar(120),
        user_agent varchar(500),
        active boolean NOT NULL DEFAULT true,
        last_success_at timestamptz,
        last_failure_at timestamptz,
        failure_count integer NOT NULL DEFAULT 0,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_notification_preferences" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        recipient_user_id uuid NOT NULL,
        in_app_enabled boolean NOT NULL DEFAULT true,
        push_enabled boolean NOT NULL DEFAULT true,
        email_enabled boolean NOT NULL DEFAULT false,
        privacy_mode boolean NOT NULL DEFAULT true,
        category_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        severity_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        quiet_hours_enabled boolean NOT NULL DEFAULT false,
        quiet_hours_start varchar(5) NOT NULL DEFAULT '21:00',
        quiet_hours_end varchar(5) NOT NULL DEFAULT '08:00',
        timezone varchar(100) NOT NULL DEFAULT 'America/New_York',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_events" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_event_id varchar(255) NOT NULL,
        tenant_id uuid,
        event_type varchar(80) NOT NULL,
        invoice_id varchar(255),
        charge_id varchar(255),
        amount_cents bigint NOT NULL DEFAULT 0,
        currency varchar(3) NOT NULL DEFAULT 'usd',
        livemode boolean NOT NULL DEFAULT false,
        occurred_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_admin_notification_dedupe" ON "admin_notifications" (recipient_user_id, deduplication_key)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admin_notification_unread" ON "admin_notifications" (recipient_user_id, read_at, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admin_notification_retention" ON "admin_notifications" (created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admin_notification_incident" ON "admin_notifications" (incident_key, created_at DESC)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_admin_push_endpoint" ON "admin_push_subscriptions" (endpoint)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_admin_push_user_active" ON "admin_push_subscriptions" (recipient_user_id, active)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_admin_notification_preference_user" ON "admin_notification_preferences" (recipient_user_id)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_billing_provider_event" ON "billing_events" (provider_event_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_billing_live_type_occurred" ON "billing_events" (livemode, event_type, occurred_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_billing_tenant_occurred" ON "billing_events" (tenant_id, occurred_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_retention" ON "audit_logs" (created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_stripe_webhook_retention" ON "stripe_webhook_events" (created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tenant_assigned_operator" ON "tenants" (assigned_operator_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_users_platform_role" ON "users" (platform_role) WHERE platform_role IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_application_assigned_operator" ON "prospect_applications" (assigned_operator_id)`,
    );

    await addConstraint(
      queryRunner,
      `ALTER TABLE "admin_notifications" ADD CONSTRAINT "FK_admin_notification_user" FOREIGN KEY (recipient_user_id) REFERENCES "users"(id) ON DELETE CASCADE`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "admin_push_subscriptions" ADD CONSTRAINT "FK_admin_push_user" FOREIGN KEY (recipient_user_id) REFERENCES "users"(id) ON DELETE CASCADE`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "admin_notification_preferences" ADD CONSTRAINT "FK_admin_notification_preference_user" FOREIGN KEY (recipient_user_id) REFERENCES "users"(id) ON DELETE CASCADE`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "billing_events" ADD CONSTRAINT "FK_billing_event_tenant" FOREIGN KEY (tenant_id) REFERENCES "tenants"(id) ON DELETE SET NULL`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "tenants" ADD CONSTRAINT "FK_tenant_assigned_operator" FOREIGN KEY (assigned_operator_id) REFERENCES "users"(id) ON DELETE SET NULL`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "prospect_applications" ADD CONSTRAINT "FK_application_assigned_operator" FOREIGN KEY (assigned_operator_id) REFERENCES "users"(id) ON DELETE SET NULL`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "operations_tasks" ADD CONSTRAINT "FK_operations_assigned_operator" FOREIGN KEY (assigned_operator_id) REFERENCES "users"(id) ON DELETE SET NULL`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "support_tickets" ADD CONSTRAINT "FK_support_assigned_operator" FOREIGN KEY (assigned_operator_id) REFERENCES "users"(id) ON DELETE SET NULL`,
    );
    await addConstraint(
      queryRunner,
      `ALTER TABLE "onboarding_records" ADD CONSTRAINT "FK_onboarding_assigned_operator" FOREIGN KEY (assigned_onboarding_owner_id) REFERENCES "users"(id) ON DELETE SET NULL`,
    );
  }

  async down(): Promise<void> {
    // Intentionally non-destructive: these records include business notification
    // and payment summaries. Rollbacks must be performed through a reviewed migration.
  }
}
