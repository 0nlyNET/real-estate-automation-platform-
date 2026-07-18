import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SchemaReadinessService } from "../../database/schema-readiness.service";
import { HealthController } from "./health.controller";

@Module({
  imports: [TerminusModule, TypeOrmModule],
  controllers: [HealthController],
  providers: [SchemaReadinessService],
  exports: [SchemaReadinessService],
})
export class HealthModule {}
