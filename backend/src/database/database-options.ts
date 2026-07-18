import { DataSourceOptions } from "typeorm";
import { buildDatabaseSslConfig } from "../common/database-ssl";
import { databaseEntities } from "./entities";
import { LegacyAuthCompatibility1784332800001 } from "./migrations/202607180001-legacy-auth-compatibility";
import { TenantSettingsIntakeKeys1784332800002 } from "./migrations/202607180002-tenant-settings-intake-keys";
import { AuditAndProviderRouting1784332800003 } from "./migrations/202607180003-audit-and-provider-routing";
import { ProductionSchemaReconciliation1784332800004 } from "./migrations/202607180004-production-schema-reconciliation";

const databaseMigrations = [
  LegacyAuthCompatibility1784332800001,
  TenantSettingsIntakeKeys1784332800002,
  AuditAndProviderRouting1784332800003,
  ProductionSchemaReconciliation1784332800004,
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
