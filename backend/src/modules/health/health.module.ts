import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SchemaReadinessService } from "../../database/schema-readiness.service";
import { HealthController } from "./health.controller";

@Module({
  imports: [TypeOrmModule],
  controllers: [HealthController],
  providers: [SchemaReadinessService],
  exports: [SchemaReadinessService],
})
export class HealthModule {}
