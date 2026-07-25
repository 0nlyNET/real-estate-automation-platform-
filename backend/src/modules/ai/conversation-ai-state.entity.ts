import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

export type ConversationOwnershipStatus =
  | 'ai_handling'
  | 'human_handling'
  | 'waiting_for_human'
  | 'paused'
  | 'closed';

@Entity({ name: 'conversation_ai_states' })
@Index(['tenantId', 'leadId'], { unique: true })
@Index(['tenantId', 'ownershipStatus'])
export class ConversationAiState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  @Column({
    name: 'ownership_status',
    type: 'varchar',
    length: 30,
    default: 'human_handling',
  })
  ownershipStatus!: ConversationOwnershipStatus;

  @Column({ name: 'ai_turn_count', type: 'int', default: 0 })
  aiTurnCount!: number;

  @Column({ name: 'usage_units', type: 'int', default: 0 })
  usageUnits!: number;

  @Column({ name: 'last_inbound_message_id_processed', type: 'uuid', nullable: true })
  lastInboundMessageIdProcessed?: string | null;

  @Column({ name: 'last_ai_response_id', type: 'uuid', nullable: true })
  lastAiResponseId?: string | null;

  @Column({ name: 'taken_over_by_user_id', type: 'uuid', nullable: true })
  takenOverByUserId?: string | null;

  @Column({ name: 'taken_over_at', type: 'timestamptz', nullable: true })
  takenOverAt?: Date | null;

  @Column({ name: 'returned_to_ai_at', type: 'timestamptz', nullable: true })
  returnedToAiAt?: Date | null;

  @Column({ name: 'escalation_reason', type: 'text', nullable: true })
  escalationReason?: string | null;

  @Column({ name: 'ai_paused_reason', type: 'text', nullable: true })
  aiPausedReason?: string | null;

  @VersionColumn({ name: 'version' })
  version!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
