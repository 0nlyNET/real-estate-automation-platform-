import { SequencesModule } from '../sequences/sequences.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Lead } from './lead.entity';
import { LeadEvent } from './lead-event.entity';
import { User } from '../users/user.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

import { TenantsModule } from '../tenants/tenants.module';
import { MessagingModule } from '../messaging/messaging.module';
import { MailModule } from '../../mail/mail.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LimitsModule } from '../limits/limits.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, LeadEvent, User, TenantSettings]),
    TenantsModule,
    MessagingModule,
    SequencesModule,
    MailModule,
    IntegrationsModule,
    LimitsModule,
  ],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
