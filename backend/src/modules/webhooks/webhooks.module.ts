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

@Module({
  imports: [
    TypeOrmModule.forFeature([Credential, Lead, Message, LeadEvent]),
    ComplianceModule,
    SequencesModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
