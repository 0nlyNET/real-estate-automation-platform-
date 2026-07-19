import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Sequence } from './sequence.entity';
import { Lead } from '../leads/lead.entity';

@Entity({ name: 'sequence_enrollments' })
export class SequenceEnrollment extends BaseEntity {
  @ManyToOne(() => Sequence, (sequence) => sequence.id)
  @JoinColumn({ name: 'sequenceId' })
  sequence!: Sequence;

  @Column({ name: 'sequenceId', type: 'uuid' })
  sequenceId!: string;

  @ManyToOne(() => Lead, (lead) => lead.enrollments)
  @JoinColumn({ name: 'leadId' })
  lead!: Lead;

  @Column({ name: 'leadId', type: 'uuid' })
  leadId!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ default: 'active' })
  status!: 'active' | 'paused' | 'completed' | 'stopped';

  @Column({ name: 'current_step_index', type: 'int', default: 0 })
  currentStepIndex!: number;

  @Column({ name: 'next_run_at', type: 'timestamptz', nullable: true })
  nextRunAt?: Date;

  @Column({ name: 'stopped_reason', type: 'varchar', nullable: true })
  stoppedReason?: 'reply' | 'manual' | 'other' | 'opt_out';

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt?: Date | null;

  @Column({ name: 'locked_by', type: 'varchar', nullable: true })
  lockedBy?: string | null;
}
