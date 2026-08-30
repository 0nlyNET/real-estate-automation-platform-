import "dotenv/config";
import { DataSource } from "typeorm";
import { buildDatabaseOptions } from "./database-options";

export default new DataSource({
  ...buildDatabaseOptions(
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  ),
  migrationsRun: false,
});
