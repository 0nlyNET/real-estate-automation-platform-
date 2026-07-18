import { Controller, Get } from "@nestjs/common";
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from "@nestjs/terminus";
import { SchemaReadinessService } from "../../database/schema-readiness.service";

@Controller("health")
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private schema: SchemaReadinessService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.db.pingCheck("database")]);
  }

  @Get("readiness")
  async readiness() {
    const report = await this.schema.inspect();
    return {
      database: { status: "up" },
      schema: this.schema.summary(report),
    };
  }
}
