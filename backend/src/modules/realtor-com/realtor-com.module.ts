import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Credential } from '../settings/credential.entity';
import { LeadsModule } from '../leads/leads.module';
import { RealtorComController } from './realtor-com.controller';
import { RealtorComService } from './realtor-com.service';

@Module({
  imports: [TypeOrmModule.forFeature([Credential]), LeadsModule],
  controllers: [RealtorComController],
  providers: [RealtorComService],
})
export class RealtorComModule {}
