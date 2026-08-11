import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AiResponseMode } from './workspace-ai-settings.entity';

export type AiRunStatus =
  | 'queued'
  | 'processing'
  | 'drafted'
  | 'response_queued'
  | 'completed'
  | 'blocked'
  | 'failed';

@Entity({ name: 'ai_runs' })
@Index('UQ_ai_runs_triggering_message', ['triggeringMessageId'], {
  unique: true,
  where: 'triggering_message_id IS NOT NULL',
})
@Index('UQ_ai_runs_first_response', ['leadId', 'triggerType'], {
  unique: true,
  where: "trigger_type = 'first_response'",
})
@Index(['tenantId', 'createdAt'])
@Index(['status', 'createdAt'])
export class AiRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  @Column({ name: 'triggering_message_id', type: 'uuid', nullable: true })
  triggeringMessageId!: string | null;

  @Column({ name: 'trigger_type', type: 'varchar', length: 30, default: 'inbound' })
  triggerType!: 'inbound' | 'first_response';

  @Column({ type: 'varchar', length: 80, default: 'openai' })
  provider!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model?: string | null;

  @Column({ type: 'varchar', length: 30 })
  mode!: AiResponseMode;

  @Column({ type: 'varchar', length: 30, default: 'queued' })
  status!: AiRunStatus;

  @Column({ type: 'double precision', nullable: true })
  confidence?: number | null;

  @Column({ name: 'prompt_metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  promptMetadata!: Record<string, unknown>;

  @Column({ name: 'structured_response', type: 'jsonb', nullable: true })
  structuredResponse?: Record<string, unknown> | null;

  @Column({ name: 'requested_tools', type: 'jsonb', default: () => "'[]'::jsonb" })
  requestedTools!: Array<Record<string, unknown>>;

  @Column({ name: 'executed_tools', type: 'jsonb', default: () => "'[]'::jsonb" })
  executedTools!: Array<Record<string, unknown>>;

  @Column({ name: 'blocked_tools', type: 'jsonb', default: () => "'[]'::jsonb" })
  blockedTools!: Array<Record<string, unknown>>;

  @Column({ name: 'input_usage', type: 'int', default: 0 })
  inputUsage!: number;

  @Column({ name: 'output_usage', type: 'int', default: 0 })
  outputUsage!: number;

  @Column({ name: 'estimated_cost_usd', type: 'double precision', nullable: true })
  estimatedCostUsd?: number | null;

  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs?: number | null;

  @Column({ name: 'error_code', type: 'varchar', length: 80, nullable: true })
  errorCode?: string | null;

  @Column({ name: 'sanitized_error', type: 'text', nullable: true })
  sanitizedError?: string | null;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt?: Date | null;

  @Column({ name: 'locked_by', type: 'varchar', length: 160, nullable: true })
  lockedBy?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
