import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Tenant } from '../tenants/tenant.entity';

@Entity({ name: 'support_tickets' })
export class SupportTicket extends BaseEntity {
  @ManyToOne(() => Tenant, (t) => t.id, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 255 })
  subject!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'varchar', length: 50, default: 'open' })
  status!: 'open' | 'acknowledged' | 'resolved' | 'closed';

  @Column({ type: 'varchar', length: 30, default: 'normal' })
  severity!: 'low' | 'normal' | 'high' | 'urgent';

  @Column({ name: 'assigned_operator_id', type: 'uuid', nullable: true })
  assignedOperatorId?: string | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt?: Date | null;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt?: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote?: string | null;
}
