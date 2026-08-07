import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Credential } from '../settings/credential.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { LeadEvent } from '../leads/lead-event.entity';

import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { ComplianceModule } from '../compliance/compliance.module';
import { SequencesModule } from '../sequences/sequences.module';
import { LeadsModule } from '../leads/leads.module';
import { AiModule } from '../ai/ai.module';
import { TwilioInboundMessage } from './twilio-inbound-message.entity';
import { TelephonyController } from './telephony.controller';
import { SendGridWebhookEvent } from './sendgrid-webhook-event.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Credential,
      Lead,
      Message,
      LeadEvent,
      TwilioInboundMessage,
      SendGridWebhookEvent,
    ]),
    ComplianceModule,
    SequencesModule,
    LeadsModule,
    AiModule,
  ],
  controllers: [WebhooksController, TelephonyController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
