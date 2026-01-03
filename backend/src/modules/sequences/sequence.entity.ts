import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { SequenceStep } from './sequence-step.entity';

@Entity({ name: 'sequences' })
export class Sequence extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name!: string;

  @Column({ name: 'lead_type', type: 'varchar', length: 50, nullable: true })
  leadType!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  temperature!: string;

  @OneToMany(() => SequenceStep, (step) => step.sequence, { cascade: true })
  steps!: SequenceStep[];
}
