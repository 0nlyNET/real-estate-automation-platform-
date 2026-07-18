import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoutingRule } from './routing-rule.entity';
import { RoutingAssignmentLog } from './routing-assignment-log.entity';
import { RoutingService } from './routing.service';
import { RoutingController } from './routing.controller';
import { User } from '../users/user.entity';
import { Lead } from '../leads/lead.entity';
import { Team } from '../teams/team.entity';
import { PresenceModule } from '../presence/presence.module';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RoutingRule, RoutingAssignmentLog, User, Lead, Team]),
    PresenceModule,
    CommonModule,
  ],
  providers: [RoutingService],
  controllers: [RoutingController],
  exports: [RoutingService],
})
export class RoutingModule {}
