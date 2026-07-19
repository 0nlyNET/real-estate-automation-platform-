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

  @Column({ name: 'approval_status', type: 'varchar', default: 'draft' })
  approvalStatus!: 'draft' | 'approved' | 'rejected';

  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId?: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt?: Date | null;

  @Column({ name: 'template_version', type: 'int', default: 1 })
  templateVersion!: number;

  @Column({ name: 'identity_label', type: 'varchar', nullable: true })
  identityLabel?: string | null;

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;
}
