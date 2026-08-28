import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'assistant_runs' })
@Index('IDX_assistant_runs_tenant_type_created', ['tenantId', 'assistantType', 'createdAt'])
@Index('IDX_assistant_runs_status', ['status', 'createdAt'])
@Index('UQ_assistant_runs_actor_type_request', ['actorId', 'assistantType', 'requestId'], { unique: true })
export class AssistantRun {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'actor_id', type: 'uuid' }) actorId!: string;
  @Column({ name: 'assistant_type', type: 'varchar', length: 30 }) assistantType!: 'client' | 'operations';
  @Column({ name: 'request_id', type: 'uuid' }) requestId!: string;
  @Column({ name: 'prompt_encrypted', type: 'text', nullable: true }) promptEncrypted!: string | null;
  @Column({ name: 'input_digest', type: 'varchar', length: 64 }) inputDigest!: string;
  @Column({ name: 'prompt_preview', type: 'varchar', length: 240 }) promptPreview!: string;
  @Column({ type: 'varchar', length: 30 }) status!: 'processing' | 'completed' | 'confirmation_required' | 'blocked' | 'failed';
  @Column({ type: 'varchar', length: 80, nullable: true }) provider!: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) model!: string | null;
  @Column({ type: 'text', nullable: true }) response!: string | null;
  @Column({ name: 'requested_actions', type: 'jsonb', default: () => "'[]'::jsonb" }) requestedActions!: Array<Record<string, unknown>>;
  @Column({ name: 'executed_actions', type: 'jsonb', default: () => "'[]'::jsonb" }) executedActions!: Array<Record<string, unknown>>;
  @Column({ name: 'blocked_actions', type: 'jsonb', default: () => "'[]'::jsonb" }) blockedActions!: Array<Record<string, unknown>>;
  @Column({ name: 'input_usage', type: 'integer', default: 0 }) inputUsage!: number;
  @Column({ name: 'output_usage', type: 'integer', default: 0 }) outputUsage!: number;
  @Column({ name: 'estimated_cost_usd', type: 'double precision', nullable: true }) estimatedCostUsd!: number | null;
  @Column({ name: 'latency_ms', type: 'integer', nullable: true }) latencyMs!: number | null;
  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true }) errorCode!: string | null;
  @Column({ name: 'sanitized_error', type: 'text', nullable: true }) sanitizedError!: string | null;
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true }) confirmedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}
