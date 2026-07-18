import { DataSourceOptions } from "typeorm";
import { buildDatabaseSslConfig } from "../common/database-ssl";
import { databaseEntities } from "./entities";
import { LegacyAuthCompatibility1784332800001 } from "./migrations/202607180001-legacy-auth-compatibility";
import { TenantSettingsIntakeKeys1784332800002 } from "./migrations/202607180002-tenant-settings-intake-keys";

const databaseMigrations = [
  LegacyAuthCompatibility1784332800001,
  TenantSettingsIntakeKeys1784332800002,
];

function migrationOptions() {
  return {
    migrations: databaseMigrations,
    migrationsRun:
      process.env.NODE_ENV === "production" ||
      process.env.RUN_MIGRATIONS === "true",
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
