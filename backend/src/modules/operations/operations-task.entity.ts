import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'operations_tasks' })
@Index(['status', 'priority', 'dueAt'])
@Index(['tenantId', 'status'])
export class OperationsTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null;

  @Column({ name: 'application_id', type: 'uuid', nullable: true })
  applicationId?: string | null;

  @Column({ type: 'varchar', length: 80 })
  category!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'varchar', length: 20, default: 'normal' })
  priority!: 'low' | 'normal' | 'high' | 'critical';

  @Column({ type: 'varchar', length: 30, default: 'open' })
  status!: 'open' | 'in_progress' | 'blocked' | 'resolved';

  @Column({ name: 'assigned_operator_id', type: 'uuid', nullable: true })
  assignedOperatorId?: string | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt?: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  @Column({ name: 'evidence_note', type: 'text', nullable: true })
  evidenceNote?: string | null;

  @Column({ name: 'related_entity_type', type: 'varchar', length: 80, nullable: true })
  relatedEntityType?: string | null;

  @Column({ name: 'related_entity_id', type: 'uuid', nullable: true })
  relatedEntityId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
