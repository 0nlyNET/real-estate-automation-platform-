import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SequencesService } from './sequences.service';
import { Sequence } from './sequence.entity';
import { SequenceEnrollment } from './sequence-enrollment.entity';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [TypeOrmModule.forFeature([Sequence, SequenceEnrollment]), QueueModule],
  providers: [SequencesService],
  exports: [SequencesService],
})
export class SequencesModule {}
