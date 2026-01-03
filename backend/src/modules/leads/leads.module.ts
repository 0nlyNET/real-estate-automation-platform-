import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Lead } from './lead.entity';
import { LeadEvent } from './lead-event.entity';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

import { TenantsModule } from '../tenants/tenants.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SequencesModule } from '../sequences/sequences.module';
import { MailModule } from '../../mail/mail.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, LeadEvent]),
    TenantsModule,
    MessagingModule,
    SequencesModule,
    MailModule,
  ],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
