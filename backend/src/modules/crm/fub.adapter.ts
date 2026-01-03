import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class FollowUpBossAdapter {
  private readonly logger = new Logger(FollowUpBossAdapter.name);

  async syncLead(payload: any) {
    this.logger.log(`Mock Follow Up Boss sync ${payload.id}`);
  }
}
