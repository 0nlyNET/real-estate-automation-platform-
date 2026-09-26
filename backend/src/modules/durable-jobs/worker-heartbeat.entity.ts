import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Persistent liveness record for each in-process worker/timer plus the
 * durable-job-backed recurring scans. Survives restarts so "last success"
 * stays accurate across deploys; consecutive failures / last error are
 * best-effort and reset when a worker reports success again.
 */
@Entity({ name: 'worker_heartbeat' })
@Index('UQ_worker_heartbeat_key', ['workerKey'], { unique: true })
export class WorkerHeartbeat {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'worker_key', type: 'varchar', length: 120 })
  workerKey!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 160 })
  displayName!: string;

  @Column({ name: 'expected_interval_seconds', type: 'integer', default: 300 })
  expectedIntervalSeconds!: number;

  @Column({ name: 'is_critical', type: 'boolean', default: false })
  isCritical!: boolean;

  /**
   * 'direct' — the worker calls WorkerHeartbeatService.recordTick itself.
   * 'durable_job' — derived from durable_jobs activity for the task types.
   * 'observed' — derived from domain-table activity (best effort); workers
   *   whose modules cannot report directly stay 'unknown' until instrumented.
   */
  @Column({ name: 'heartbeat_source', type: 'varchar', length: 20, default: 'direct' })
  heartbeatSource!: 'direct' | 'durable_job' | 'observed';

  @Column({ name: 'last_success_at', type: 'timestamptz', nullable: true })
  lastSuccessAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'consecutive_failures', type: 'integer', default: 0 })
  consecutiveFailures!: number;

  @Column({ name: 'last_check_at', type: 'timestamptz', nullable: true })
  lastCheckAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
