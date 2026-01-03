import { Module } from '@nestjs/common';
import { CrmService } from './crm.service';
import { HubspotAdapter } from './hubspot.adapter';
import { FollowUpBossAdapter } from './fub.adapter';

@Module({
  providers: [CrmService, HubspotAdapter, FollowUpBossAdapter],
  exports: [CrmService],
})
export class CrmModule {}
