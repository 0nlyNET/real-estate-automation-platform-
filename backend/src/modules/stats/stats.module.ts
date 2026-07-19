import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { User } from '../users/user.entity';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { ComplianceOptOut } from '../compliance/compliance-optout.entity';
import { LeadStageEvent } from '../leads/lead-stage-event.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Lead, Message, ComplianceOptOut, LeadStageEvent, TenantSettings]), CommonModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
