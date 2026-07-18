import "dotenv/config";
import { DataSource } from "typeorm";
import { buildDatabaseOptions } from "./database-options";

export default new DataSource({
  ...buildDatabaseOptions(),
  migrationsRun: false,
});
