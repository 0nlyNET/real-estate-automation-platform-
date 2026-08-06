import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Credential } from '../settings/credential.entity';
import { LeadsModule } from '../leads/leads.module';
import { RealtorComController } from './realtor-com.controller';
import { RealtorComService } from './realtor-com.service';
import { LeadIngestionModule } from '../lead-ingestion/lead-ingestion.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Credential]),
    LeadsModule,
    LeadIngestionModule,
  ],
  controllers: [RealtorComController],
  providers: [RealtorComService],
})
export class RealtorComModule {}
