import { DataSourceOptions } from "typeorm";
import { buildDatabaseSslConfig } from "../common/database-ssl";
import { databaseEntities } from "./entities";
import { LegacyAuthCompatibility1784332800001 } from "./migrations/202607180001-legacy-auth-compatibility";
import { TenantSettingsIntakeKeys1784332800002 } from "./migrations/202607180002-tenant-settings-intake-keys";
import { AuditAndProviderRouting1784332800003 } from "./migrations/202607180003-audit-and-provider-routing";
import { ProductionSchemaReconciliation1784332800004 } from "./migrations/202607180004-production-schema-reconciliation";
import { ClientReadinessFoundations1784419200001 } from './migrations/202607190001-client-readiness-foundations';
import { AdminOperationsNotifications1784505600001 } from './migrations/202607200001-admin-operations-notifications';
import { ClientTodayWorkflow1784592000001 } from './migrations/202607210001-client-today-workflow';
import { ServiceSuspension1784764800001 } from './migrations/202607230001-service-suspension';
import { ClientExperienceReadiness1784851200001 } from './migrations/202607240001-client-experience-readiness';
import { ControlledAiLeadAgent1784937600001 } from './migrations/202607250001-controlled-ai-lead-agent';
import { PlatformManagedIntegrations1785024000001 } from './migrations/202607260001-platform-managed-integrations';
import { StripeSetupFeeTracking1785801600001 } from './migrations/202608040001-stripe-setup-fee-tracking';
import { FirstClientSafetyPipeline1785974400001 } from './migrations/202608060001-first-client-safety-pipeline';
import { MessagingDeliveryReliability1786060800001 } from './migrations/202608070001-messaging-delivery-reliability';
import { ClientReadinessObservability1786060800002 } from './migrations/202608070002-client-readiness-observability';
import { LaunchSafeguards1786406400001 } from './migrations/202608110001-launch-safeguards';
import { ManagedProviderArchitecture1786492800001 } from './migrations/202608120001-managed-provider-architecture';
import { TurnkeyLaunchOperation1786579200001 } from './migrations/202608130001-turnkey-launch-operation';
import { ManagedCrmAiAutopilot1786665600001 } from './migrations/202608140001-managed-crm-ai-autopilot';
import { GoogleCalendarReliability1787011200001 } from './migrations/202608180001-google-calendar-reliability';
import { MultiProviderScheduling1787011200002 } from './migrations/202608180002-multi-provider-scheduling';

const databaseMigrations = [
  LegacyAuthCompatibility1784332800001,
  TenantSettingsIntakeKeys1784332800002,
  AuditAndProviderRouting1784332800003,
  ProductionSchemaReconciliation1784332800004,
  ClientReadinessFoundations1784419200001,
  AdminOperationsNotifications1784505600001,
  ClientTodayWorkflow1784592000001,
  ServiceSuspension1784764800001,
  ClientExperienceReadiness1784851200001,
  ControlledAiLeadAgent1784937600001,
  PlatformManagedIntegrations1785024000001,
  StripeSetupFeeTracking1785801600001,
  FirstClientSafetyPipeline1785974400001,
  MessagingDeliveryReliability1786060800001,
  ClientReadinessObservability1786060800002,
  LaunchSafeguards1786406400001,
  ManagedProviderArchitecture1786492800001,
  TurnkeyLaunchOperation1786579200001,
  ManagedCrmAiAutopilot1786665600001,
  GoogleCalendarReliability1787011200001,
  MultiProviderScheduling1787011200002,
];

function migrationOptions() {
  const migrationOverride = process.env.RUN_MIGRATIONS;

  return {
    migrations: databaseMigrations,
    migrationsRun:
      migrationOverride === "true" ||
      (migrationOverride !== "false" && process.env.NODE_ENV !== "test"),
    migrationsTableName: "app_migrations",
    migrationsTransactionMode: "all" as const,
  };
}

export function buildDatabaseOptions(): DataSourceOptions {
  const url = process.env.DATABASE_URL;

  if (url) {
    const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
    const allowSync = process.env.TYPEORM_SYNC === "true" && isLocal;

    return {
      type: "postgres",
      url,
      entities: [...databaseEntities],
      synchronize: allowSync,
      ssl: buildDatabaseSslConfig(!isLocal),
      ...migrationOptions(),
    };
  }

  return {
    type: "postgres",
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    username: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    database: process.env.DB_NAME || "real_estate",
    entities: [...databaseEntities],
    synchronize: process.env.TYPEORM_SYNC === "true",
    ssl: buildDatabaseSslConfig(false),
    ...migrationOptions(),
  };
}
