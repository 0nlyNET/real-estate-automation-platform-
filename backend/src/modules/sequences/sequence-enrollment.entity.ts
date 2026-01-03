import { Column, Entity, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Sequence } from './sequence.entity';
import { Lead } from '../leads/lead.entity';

@Entity({ name: 'sequence_enrollments' })
export class SequenceEnrollment extends BaseEntity {
  @ManyToOne(() => Sequence, (sequence) => sequence.id)
  sequence!: Sequence;

  @ManyToOne(() => Lead, (lead) => lead.enrollments)
  lead!: Lead;

  @Column({ default: 'active' })
  status!: 'active' | 'completed' | 'stopped';
}
