import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Message } from './message.entity';
import { Tenant } from '../tenants/tenant.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Lead } from '../leads/lead.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { SequencesModule } from '../sequences/sequences.module';
import { MessagingService } from './messaging.service';
import { MessagingController } from './messaging.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Tenant, LeadEvent, Lead, TenantSettings]),
    SequencesModule,
  ],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
