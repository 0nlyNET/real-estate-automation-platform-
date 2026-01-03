import { Injectable, Logger } from '@nestjs/common';
import { HubspotAdapter } from './hubspot.adapter';
import { FollowUpBossAdapter } from './fub.adapter';

export type CrmProvider = 'hubspot' | 'follow_up_boss';

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);
  private readonly adapters: Record<CrmProvider, { syncLead: (lead: any) => Promise<void> }> = {
    hubspot: this.hubspotAdapter,
    follow_up_boss: this.followUpBossAdapter,
  };

  constructor(
    private readonly hubspotAdapter: HubspotAdapter,
    private readonly followUpBossAdapter: FollowUpBossAdapter,
  ) {}

  async syncLead(provider: CrmProvider, payload: any) {
    const adapter = this.adapters[provider];
    if (!adapter) {
      this.logger.warn(`No adapter for ${provider}`);
      return;
    }
    await adapter.syncLead(payload);
  }
}
