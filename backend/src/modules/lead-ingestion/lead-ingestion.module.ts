import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LeadEvent } from "../leads/lead-event.entity";
import { Lead } from "../leads/lead.entity";
import { Credential } from "../settings/credential.entity";
import { TenantSettings } from "../settings/tenant-settings.entity";
import { Tenant } from "../tenants/tenant.entity";
import { LeadIngestionController } from "./lead-ingestion.controller";
import { LeadIngestionEvent } from "./lead-ingestion-event.entity";
import { LeadIngestionService } from "./lead-ingestion.service";
import { RealtorLeadAdapter } from "./realtor-lead.adapter";
import { ZillowLeadAdapter } from "./zillow-lead.adapter";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Lead,
      LeadEvent,
      LeadIngestionEvent,
      Tenant,
      TenantSettings,
      Credential,
    ]),
  ],
  controllers: [LeadIngestionController],
  providers: [LeadIngestionService, ZillowLeadAdapter, RealtorLeadAdapter],
  exports: [LeadIngestionService],
})
export class LeadIngestionModule {}
