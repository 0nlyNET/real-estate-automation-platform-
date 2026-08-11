import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'durable_jobs' })
@Index('IDX_durable_jobs_due', ['status', 'nextRunAt'])
@Index('UQ_durable_jobs_dedupe', ['dedupeKey'], {
  unique: true,
  where: '"dedupe_key" IS NOT NULL',
})
export class DurableJob {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'task_type' })
  taskType!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ name: 'dedupe_key', type: 'varchar', nullable: true })
  dedupeKey!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ default: 'scheduled' })
  status!: 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled';

  @Column({ name: 'next_run_at', type: 'timestamptz' })
  nextRunAt!: Date;

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 12 })
  maxAttempts!: number;

  @Column({ name: 'lease_owner', type: 'varchar', nullable: true })
  leaseOwner!: string | null;

  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
