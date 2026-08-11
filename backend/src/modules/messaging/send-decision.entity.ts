import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'send_decisions' })
@Index('UQ_send_decisions_message', ['messageId'], { unique: true })
@Index('IDX_send_decisions_tenant_created', ['tenantId', 'createdAt'])
export class SendDecision {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  @Column({ name: 'message_id', type: 'uuid' })
  messageId!: string;

  @Column({ name: 'automation_id', type: 'uuid', nullable: true })
  automationId!: string | null;

  @Column({ name: 'enrollment_id', type: 'uuid', nullable: true })
  enrollmentId!: string | null;

  @Column({ name: 'step_index', type: 'integer', nullable: true })
  stepIndex!: number | null;

  @Column({ name: 'template_version', type: 'integer', nullable: true })
  templateVersion!: number | null;

  @Column({ name: 'usage_reservation_id', type: 'uuid', nullable: true })
  usageReservationId!: string | null;

  @Column({ name: 'lead_snapshot', type: 'jsonb' })
  leadSnapshot!: Record<string, unknown>;

  @Column({ name: 'configuration_snapshot', type: 'jsonb' })
  configurationSnapshot!: Record<string, unknown>;

  @Column({ name: 'safety_decision', type: 'jsonb' })
  safetyDecision!: Record<string, unknown>;

  @Column({ name: 'usage_decision', type: 'jsonb' })
  usageDecision!: Record<string, unknown>;

  @Column({ name: 'provider_identity', type: 'jsonb' })
  providerIdentity!: Record<string, unknown>;

  @Column({ name: 'decision', default: 'pending' })
  decision!: 'pending' | 'allowed' | 'blocked' | 'submitted' | 'failed';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
