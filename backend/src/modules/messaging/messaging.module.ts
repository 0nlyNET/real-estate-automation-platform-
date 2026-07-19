import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { InboxSendService } from './inbox-send.service';

import { Message } from './message.entity';
import { Lead } from '../leads/lead.entity';
import { Tenant } from '../tenants/tenant.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Credential } from '../settings/credential.entity';

import { SequencesModule } from '../sequences/sequences.module';
import { ComplianceModule } from '../compliance/compliance.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Lead, Tenant, LeadEvent, Credential]),
    SequencesModule,
    ComplianceModule,
  ],
  controllers: [MessagingController],
  providers: [MessagingService, InboxSendService],
  exports: [MessagingService],
})
export class MessagingModule {}
