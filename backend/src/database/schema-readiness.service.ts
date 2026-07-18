import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import {
  inspectDatabaseSchema,
  SchemaReadinessReport,
} from "./schema-readiness";

@Injectable()
export class SchemaReadinessService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchemaReadinessService.name);
  private latest: SchemaReadinessReport | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async inspect() {
    this.latest = await inspectDatabaseSchema(this.dataSource);
    return this.latest;
  }

  summary(report = this.latest) {
    if (!report) return { status: "unknown" as const };
    return {
      status: report.ok ? ("up" as const) : ("down" as const),
      fingerprint: report.fingerprint,
      expectedTables: report.expectedTables,
      actualTables: report.actualTables,
      missingTableCount: report.missingTables.length,
      missingColumnCount: report.missingColumns.length,
    };
  }

  async onApplicationBootstrap() {
    try {
      const report = await this.inspect();
      if (report.ok) {
        this.logger.log(
          `Database schema ready (${report.expectedTables} entity tables, fingerprint=${report.fingerprint})`,
        );
        return;
      }

      this.logger.error(
        `Database schema incomplete (fingerprint=${report.fingerprint}) ` +
          JSON.stringify({
            missingTables: report.missingTables,
            missingColumns: report.missingColumns,
          }),
      );
    } catch (error: any) {
      this.logger.error(
        `Database schema inspection failed: ${error?.message || error}`,
        error?.stack,
      );
    }
  }
}
