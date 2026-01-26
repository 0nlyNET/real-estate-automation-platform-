import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sequence } from './sequence.entity';
import { SequenceEnrollment } from './sequence-enrollment.entity';
import { SequenceStep } from './sequence-step.entity';
import { SequencesService } from './sequences.service';
import { Message } from '../messaging/message.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Tenant } from '../tenants/tenant.entity';
import { Lead } from '../leads/lead.entity';
import { TenantSettings } from '../settings/tenant-settings.entity'; // ADD THIS
import { SequencesController } from './sequences.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Sequence,
      SequenceEnrollment,
      SequenceStep,
      Message,
      LeadEvent,
      Tenant,
      Lead,
      TenantSettings, // ADD THIS
    ]),
  ],
  controllers: [SequencesController],
  providers: [SequencesService],
  exports: [SequencesService],
})
export class SequencesModule {}