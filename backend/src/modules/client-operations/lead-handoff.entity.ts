import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Lead } from '../leads/lead.entity';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';

export type HandoffPriority = 'normal' | 'high' | 'urgent';
export type HandoffStatus = 'open' | 'opened' | 'snoozed' | 'completed';

@Entity({ name: 'lead_handoffs' })
@Index(['tenantId', 'status', 'dueAt'])
@Index(['assignedUserId', 'status', 'dueAt'])
@Index('IDX_lead_handoff_one_active', ['leadId'], {
  unique: true,
  where: "status IN ('open', 'opened', 'snoozed')",
})
export class LeadHandoff extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  @ManyToOne(() => Lead, (lead) => lead.handoffs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id' })
  lead!: Lead;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId?: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_user_id' })
  assignedUser?: User | null;

  @Column({ type: 'varchar', length: 20, default: 'high' })
  priority!: HandoffPriority;

  @Column({ type: 'varchar', length: 20, default: 'open' })
  status!: HandoffStatus;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'text' })
  summary!: string;

  @Column({ name: 'recommended_action', type: 'varchar', length: 255 })
  recommendedAction!: string;

  @Column({ name: 'latest_context', type: 'text', nullable: true })
  latestContext?: string | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt?: Date | null;

  @Column({ name: 'snoozed_until', type: 'timestamptz', nullable: true })
  snoozedUntil?: Date | null;

  @Column({ name: 'opened_at', type: 'timestamptz', nullable: true })
  openedAt?: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  @Column({ name: 'completion_note', type: 'text', nullable: true })
  completionNote?: string | null;

  @Column({ name: 'admin_escalated_at', type: 'timestamptz', nullable: true })
  adminEscalatedAt?: Date | null;
}
