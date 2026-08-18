import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AiResponseMode =
  | 'human_only'
  | 'draft'
  | 'controlled_autopilot';

export type AiApprovalStatus = 'draft' | 'approved';

@Entity({ name: 'workspace_ai_settings' })
@Index(['tenantId'], { unique: true })
export class WorkspaceAiSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'ai_enabled', type: 'boolean', default: false })
  aiEnabled!: boolean;

  @Column({ name: 'ai_first_responder_enabled', type: 'boolean', default: true })
  aiFirstResponderEnabled!: boolean;

  @Column({ name: 'allowed_channels', type: 'simple-array', default: 'sms,email' })
  allowedChannels!: Array<'sms' | 'email'>;

  @Column({ type: 'varchar', length: 40, default: 'professional_warm' })
  tone!: 'professional_warm' | 'concise' | 'friendly';

  @Column({ name: 'booking_behavior', type: 'varchar', length: 40, default: 'verified_link_only' })
  bookingBehavior!: 'calendar_booking' | 'verified_link_only' | 'handoff' | 'disabled';

  @Column({ name: 'response_mode', type: 'varchar', length: 30, default: 'human_only' })
  responseMode!: AiResponseMode;

  @Column({ name: 'identity_label', type: 'varchar', length: 160, nullable: true })
  identityLabel?: string | null;

  @Column({ name: 'maximum_automatic_turns', type: 'int', default: 6 })
  maximumAutomaticTurns!: number;

  @Column({ name: 'minimum_confidence_threshold', type: 'double precision', default: 0.82 })
  minimumConfidenceThreshold!: number;

  @Column({ name: 'allowed_topics', type: 'simple-array', nullable: true })
  allowedTopics?: string[] | null;

  @Column({ name: 'escalation_rules', type: 'jsonb', default: () => "'{}'::jsonb" })
  escalationRules!: Record<string, unknown>;

  @Column({ name: 'per_conversation_usage_limit', type: 'int', default: 12_000 })
  perConversationUsageLimit!: number;

  @Column({ name: 'monthly_workspace_usage_limit', type: 'int', default: 500_000 })
  monthlyWorkspaceUsageLimit!: number;

  @Column({ name: 'ai_paused', type: 'boolean', default: false })
  aiPaused!: boolean;

  @Column({ name: 'ai_paused_reason', type: 'text', nullable: true })
  aiPausedReason?: string | null;

  @Column({
    name: 'configuration_approval_status',
    type: 'varchar',
    length: 20,
    default: 'draft',
  })
  configurationApprovalStatus!: AiApprovalStatus;

  @Column({ name: 'configuration_approved_at', type: 'timestamptz', nullable: true })
  configurationApprovedAt?: Date | null;

  @Column({ name: 'configuration_approved_by_id', type: 'uuid', nullable: true })
  configurationApprovedById?: string | null;

  @Column({ name: 'last_configuration_update', type: 'timestamptz', default: () => 'now()' })
  lastConfigurationUpdate!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
