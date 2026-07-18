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
import { LimitsModule } from '../limits/limits.module';
import { Team } from '../teams/team.entity';
import { CommonModule } from '../../common/common.module';
import { RoutingModule } from '../routing/routing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, LeadEvent, User, Team, TenantSettings]),
    TenantsModule,
    MessagingModule,
    SequencesModule,
    MailModule,
    LimitsModule,
    CommonModule,
    RoutingModule,
  ],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
