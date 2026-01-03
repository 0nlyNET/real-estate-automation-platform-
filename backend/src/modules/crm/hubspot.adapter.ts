import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class HubspotAdapter {
  private readonly logger = new Logger(HubspotAdapter.name);

  async syncLead(payload: any) {
    this.logger.log(`Mock HubSpot sync ${payload.id}`);
  }
}
