import { Column, Entity, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Sequence } from './sequence.entity';

@Entity({ name: 'sequence_steps' })
export class SequenceStep extends BaseEntity {
  @ManyToOne(() => Sequence, (sequence) => sequence.steps)
  sequence!: Sequence;

  @Column()
  offsetMinutes!: number;

  @Column()
  channel!: 'sms' | 'email';

  @Column({ type: 'text' })
  template!: string;
}
