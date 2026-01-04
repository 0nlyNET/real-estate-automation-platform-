import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sequence } from './sequence.entity';
import { SequenceEnrollment } from './sequence-enrollment.entity';
import { SequenceStep } from './sequence-step.entity';
import { SequencesService } from './sequences.service';

@Module({
  imports: [TypeOrmModule.forFeature([Sequence, SequenceEnrollment, SequenceStep])],
  providers: [SequencesService],
  exports: [SequencesService],
})
export class SequencesModule {}