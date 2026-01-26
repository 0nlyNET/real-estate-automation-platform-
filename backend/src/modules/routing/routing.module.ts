import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoutingRule } from './routing-rule.entity';
import { RoutingAssignmentLog } from './routing-assignment-log.entity';
import { RoutingService } from './routing.service';
import { RoutingController } from './routing.controller';

@Module({
  imports: [TypeOrmModule.forFeature([RoutingRule, RoutingAssignmentLog])],
  providers: [RoutingService],
  controllers: [RoutingController],
  exports: [RoutingService],
})
export class RoutingModule {}
