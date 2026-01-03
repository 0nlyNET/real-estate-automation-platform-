import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Sequence } from './sequence.entity'; // keep your actual imports
import { SequenceEnrollment } from './sequence-enrollment.entity'; // keep your actual imports

@Module({
  imports: [TypeOrmModule.forFeature([Sequence, SequenceEnrollment])],
})
export class SequencesModule {}
