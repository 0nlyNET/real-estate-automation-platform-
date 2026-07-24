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

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show';

@Entity({ name: 'appointments' })
@Index(['tenantId', 'status', 'startsAt'])
@Index(['assignedUserId', 'status', 'startsAt'])
@Index('IDX_appointment_external_event', ['tenantId', 'externalEventId'], {
  unique: true,
  where: 'external_event_id IS NOT NULL',
})
export class Appointment extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  @ManyToOne(() => Lead, (lead) => lead.appointments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id' })
  lead!: Lead;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId?: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_user_id' })
  assignedUser?: User | null;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt!: Date;

  @Column({ type: 'varchar', length: 20, default: 'scheduled' })
  status!: AppointmentStatus;

  @Column({ type: 'varchar', length: 30, default: 'manual' })
  source!: 'manual' | 'conversation' | 'external';

  @Column({ name: 'calendar_source', type: 'varchar', length: 80, default: 'RealtyTechAI' })
  calendarSource!: string;

  @Column({ name: 'confirmation_status', type: 'varchar', length: 30, default: 'pending' })
  confirmationStatus!: 'pending' | 'confirmed' | 'declined';

  @Column({ name: 'confirmation_task_created_at', type: 'timestamptz', nullable: true })
  confirmationTaskCreatedAt?: Date | null;

  @Column({ name: 'reminder_status', type: 'varchar', length: 30, default: 'scheduled' })
  reminderStatus!: 'scheduled' | 'sent' | 'cancelled';

  @Column({ name: 'reminder_sent_at', type: 'timestamptz', nullable: true })
  reminderSentAt?: Date | null;

  @Column({ name: 'follow_up_status', type: 'varchar', length: 30, default: 'not_due' })
  followUpStatus!: 'not_due' | 'due' | 'completed';

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ name: 'external_event_id', type: 'varchar', length: 255, nullable: true })
  externalEventId?: string | null;
}
