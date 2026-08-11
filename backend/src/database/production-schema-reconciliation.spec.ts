import { readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import { DataType, newDb } from "pg-mem";
import { DataSource } from "typeorm";
import { databaseEntities } from "./entities";
import { inspectDatabaseSchema } from "./schema-readiness";
import { ProductionSchemaReconciliation1784332800004 } from "./migrations/202607180004-production-schema-reconciliation";
import { ClientReadinessFoundations1784419200001 } from "./migrations/202607190001-client-readiness-foundations";
import { AdminOperationsNotifications1784505600001 } from "./migrations/202607200001-admin-operations-notifications";
import { ClientTodayWorkflow1784592000001 } from "./migrations/202607210001-client-today-workflow";
import { ServiceSuspension1784764800001 } from "./migrations/202607230001-service-suspension";
import { ClientExperienceReadiness1784851200001 } from "./migrations/202607240001-client-experience-readiness";
import { ControlledAiLeadAgent1784937600001 } from "./migrations/202607250001-controlled-ai-lead-agent";
import { PlatformManagedIntegrations1785024000001 } from "./migrations/202607260001-platform-managed-integrations";
import { StripeSetupFeeTracking1785801600001 } from "./migrations/202608040001-stripe-setup-fee-tracking";
import { FirstClientSafetyPipeline1785974400001 } from "./migrations/202608060001-first-client-safety-pipeline";
import { MessagingDeliveryReliability1786060800001 } from "./migrations/202608070001-messaging-delivery-reliability";
import { ClientReadinessObservability1786060800002 } from "./migrations/202608070002-client-readiness-observability";
import { LaunchSafeguards1786406400001 } from "./migrations/202608110001-launch-safeguards";
import { ManagedProviderArchitecture1786492800001 } from "./migrations/202608120001-managed-provider-architecture";
import { TurnkeyLaunchOperation1786579200001 } from "./migrations/202608130001-turnkey-launch-operation";
import { Credential } from "../modules/settings/credential.entity";
import { SequenceStep } from "../modules/sequences/sequence-step.entity";

function legacySql(filename: string) {
  return readFileSync(
    resolve(__dirname, "../../migrations", filename),
    "utf8",
  ).replace(/CREATE EXTENSION IF NOT EXISTS [^;]+;/gi, "");
}

function memoryDatabase() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: "current_database",
    returns: DataType.text,
    implementation: () => "realtytechai_test",
  });
  db.public.registerFunction({
    name: "version",
    returns: DataType.text,
    implementation: () => "PostgreSQL 16.0",
  });
  db.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    impure: true,
    implementation: randomUUID,
  });
  return db;
}

function dataSourceFor(db: ReturnType<typeof memoryDatabase>) {
  return db.adapters.createTypeormDataSource({
    type: "postgres",
    entities: [...databaseEntities],
    migrations: [],
    migrationsRun: false,
  });
}

describe("deployed legacy schema reproduction", () => {
  it("repairs the legacy schema without losing integration data", async () => {
    const db = memoryDatabase();

    db.public.none(legacySql("001-init.fixed.sql"));
    db.public.none(legacySql("20260202_add_first_contact_sent_at.sql"));
    db.public.none(legacySql("20260312_create_password_reset_tokens.sql"));
    db.public.none(`
      CREATE TABLE tenant_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        tenant_id varchar,
        time_zone varchar NOT NULL DEFAULT 'America/New_York',
        quiet_hours_start varchar NOT NULL DEFAULT '21:00',
        quiet_hours_end varchar NOT NULL DEFAULT '08:00',
        booking_link varchar,
        automations_enabled boolean NOT NULL DEFAULT true,
        round_robin_enabled boolean NOT NULL DEFAULT false,
        round_robin_team_id varchar,
        round_robin_last_user_id varchar,
        zapier_api_key_hash varchar,
        zapier_api_key_last4 varchar,
        webhook_url varchar,
        webhook_events text,
        facebook_connected boolean NOT NULL DEFAULT false,
        facebook_page_name varchar,
        facebook_form_id varchar,
        twilio_account_sid varchar,
        twilio_auth_token_enc varchar,
        twilio_from_number varchar,
        twilio_messaging_service_sid varchar,
        sendgrid_api_key_enc varchar,
        sendgrid_from_email varchar,
        sendgrid_from_name varchar,
        lead_source varchar,
        lead_source_other_label varchar
      );
    `);

    const tenantId = randomUUID();
    const userId = randomUUID();
    const sequenceId = randomUUID();
    const stepId = randomUUID();
    const credentialId = randomUUID();
    db.public.none(`
      INSERT INTO tenants (id, name, slug)
      VALUES ('${tenantId}', 'Legacy Realty', 'legacy-realty');
      INSERT INTO users (id, email, name, password_hash, tenant_id)
      VALUES ('${userId}', 'broker@example.com', 'Broker', 'legacy-hash', '${tenantId}');
      INSERT INTO sequences (id, tenant_id, name)
      VALUES ('${sequenceId}', '${tenantId}', 'Legacy nurture');
      INSERT INTO sequence_steps (id, sequence_id, offset_minutes, channel, template)
      VALUES ('${stepId}', '${sequenceId}', 15, 'sms', 'Legacy follow-up');
      INSERT INTO credentials (id, tenant_id, provider, encrypted_value)
      VALUES ('${credentialId}', '${tenantId}', 'twilio', 'legacy-ciphertext');
    `);

    const dataSource: DataSource = dataSourceFor(db);
    await dataSource.initialize();

    const before = await inspectDatabaseSchema(dataSource);
    expect(before).toMatchObject({
      ok: false,
      expectedTables: 51,
      actualTables: 12,
      missingTables: [
        "admin_notification_preferences",
        "admin_notifications",
        "admin_push_subscriptions",
        "agent_presence",
        "ai_runs",
        "appointments",
        "billing_events",
        "brokerage_ai_knowledge",
        "communication_suppressions",
        "compliance_events",
        "compliance_optouts",
        "conversation_ai_states",
        "durable_jobs",
        "lead_consent_records",
        "lead_handoffs",
        "lead_ingestion_events",
        "lead_stage_events",
        "offboarding_requests",
        "onboarding_records",
        "operations_tasks",
        "platform_ai_controls",
        "platform_credentials",
        "prospect_applications",
        "routing_assignment_logs",
        "routing_rules",
        "send_decisions",
        "sendgrid_webhook_events",
        "stripe_webhook_events",
        "support_tickets",
        "teams",
        "tenant_email_identities",
        "tenant_messaging_resources",
        "tenant_quiet_hours",
        "test_runs",
        "twilio_inbound_messages",
        "usage_buckets",
        "usage_policies",
        "usage_reservations",
        "workspace_ai_settings",
      ],
    });

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await new ProductionSchemaReconciliation1784332800004().up(queryRunner);
    await new ClientReadinessFoundations1784419200001().up(queryRunner);
    await new AdminOperationsNotifications1784505600001().up(queryRunner);
    await new ClientTodayWorkflow1784592000001().up(queryRunner);
    await new ServiceSuspension1784764800001().up(queryRunner);
    await new ClientExperienceReadiness1784851200001().up(queryRunner);
    await new ControlledAiLeadAgent1784937600001().up(queryRunner);
    await new PlatformManagedIntegrations1785024000001().up(queryRunner);
    await new StripeSetupFeeTracking1785801600001().up(queryRunner);
    await new FirstClientSafetyPipeline1785974400001().up(queryRunner);
    await new MessagingDeliveryReliability1786060800001().up(queryRunner);
    await new ClientReadinessObservability1786060800002().up(queryRunner);
    await new LaunchSafeguards1786406400001().up(queryRunner);
    await new ManagedProviderArchitecture1786492800001().up(queryRunner);
    await new TurnkeyLaunchOperation1786579200001().up(queryRunner);
    await queryRunner.release();

    await expect(inspectDatabaseSchema(dataSource)).resolves.toMatchObject({
      ok: true,
      expectedTables: 51,
      actualTables: 51,
      missingTables: [],
      missingColumns: [],
    });

    await expect(
      dataSource
        .getRepository(Credential)
        .findOneByOrFail({ id: credentialId }),
    ).resolves.toMatchObject({
      id: credentialId,
      encryptedValue: "legacy-ciphertext",
    });
    await expect(
      dataSource.getRepository(SequenceStep).findOneByOrFail({ id: stepId }),
    ).resolves.toMatchObject({ id: stepId, offsetMinutes: 15 });

    await expect(
      dataSource.getRepository(Credential).save({
        tenant: { id: tenantId },
        provider: "sendgrid",
        routingKey: "from@example.com",
        encryptedValue: "new-ciphertext",
      }),
    ).resolves.toMatchObject({ provider: "sendgrid" });
    await expect(
      dataSource.getRepository(Credential).save({
        tenant: { id: tenantId },
        provider: "twilio",
        encryptedValue: "duplicate-provider-row",
      }),
    ).rejects.toBeDefined();
    await expect(
      dataSource.getRepository(SequenceStep).save({
        sequence: { id: sequenceId },
        offsetMinutes: 30,
        channel: "email",
        template: "New follow-up",
      }),
    ).resolves.toMatchObject({ offsetMinutes: 30 });

    await dataSource.destroy();
  });

  it("bootstraps all application tables on an empty database", async () => {
    const db = memoryDatabase();
    const dataSource: DataSource = dataSourceFor(db);
    await dataSource.initialize();

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await new ProductionSchemaReconciliation1784332800004().up(queryRunner);
    await new ClientReadinessFoundations1784419200001().up(queryRunner);
    await new AdminOperationsNotifications1784505600001().up(queryRunner);
    await new ClientTodayWorkflow1784592000001().up(queryRunner);
    await new ServiceSuspension1784764800001().up(queryRunner);
    await new ClientExperienceReadiness1784851200001().up(queryRunner);
    await new ControlledAiLeadAgent1784937600001().up(queryRunner);
    await new PlatformManagedIntegrations1785024000001().up(queryRunner);
    await new StripeSetupFeeTracking1785801600001().up(queryRunner);
    await new FirstClientSafetyPipeline1785974400001().up(queryRunner);
    await new MessagingDeliveryReliability1786060800001().up(queryRunner);
    await new ClientReadinessObservability1786060800002().up(queryRunner);
    await new LaunchSafeguards1786406400001().up(queryRunner);
    await new ManagedProviderArchitecture1786492800001().up(queryRunner);
    await new TurnkeyLaunchOperation1786579200001().up(queryRunner);
    await queryRunner.release();

    await expect(inspectDatabaseSchema(dataSource)).resolves.toMatchObject({
      ok: true,
      expectedTables: 51,
      actualTables: 51,
      missingTables: [],
      missingColumns: [],
    });

    const rollbackRunner = dataSource.createQueryRunner();
    await rollbackRunner.connect();
    await new TurnkeyLaunchOperation1786579200001().down(rollbackRunner);
    await new ManagedProviderArchitecture1786492800001().down(rollbackRunner);
    await new LaunchSafeguards1786406400001().down(rollbackRunner);
    await new ClientReadinessObservability1786060800002().down(rollbackRunner);
    await new MessagingDeliveryReliability1786060800001().down(rollbackRunner);
    await new FirstClientSafetyPipeline1785974400001().down(rollbackRunner);
    await rollbackRunner.release();
    await expect(
      dataSource.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN ('lead_ingestion_events', 'twilio_inbound_messages')`,
      ),
    ).resolves.toEqual([]);

    await dataSource.destroy();
  });
});
