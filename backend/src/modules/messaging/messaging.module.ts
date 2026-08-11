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
import { ClientOperationsModule } from '../client-operations/client-operations.module';
import { SettingsModule } from '../settings/settings.module';
import { AiModule } from '../ai/ai.module';
import { Appointment } from '../client-operations/appointment.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { MessageSafetyService } from './message-safety.service';
import { LimitsModule } from '../limits/limits.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SendDecision } from './send-decision.entity';
import { SendDecisionService } from './send-decision.service';
import { SequenceEnrollment } from '../sequences/sequence-enrollment.entity';
import { TestRun } from '../testing/test-run.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Message,
      Lead,
      Tenant,
      LeadEvent,
      Credential,
      TenantSettings,
      Appointment,
      SendDecision,
      SequenceEnrollment,
      TestRun,
    ]),
    SequencesModule,
    ComplianceModule,
    ClientOperationsModule,
    SettingsModule,
    AiModule,
    LimitsModule,
    IntegrationsModule,
  ],
  controllers: [MessagingController],
  providers: [
    MessagingService,
    InboxSendService,
    MessageSafetyService,
    SendDecisionService,
  ],
  exports: [MessagingService, MessageSafetyService, AiModule],
})
export class MessagingModule {}
