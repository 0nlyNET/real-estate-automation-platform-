import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { SequenceStep } from './sequence-step.entity';

@Entity({ name: 'sequences' })
export class Sequence extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'boolean', default: false })
  active!: boolean;

  @Column({ name: 'lead_type', type: 'varchar', length: 50, nullable: true })
  leadType!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  temperature!: string;

  @OneToMany(() => SequenceStep, (step) => step.sequence, { cascade: true })
  steps!: SequenceStep[];
}
