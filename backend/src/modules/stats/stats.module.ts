import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { User } from '../users/user.entity';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Lead, Message]), CommonModule],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
