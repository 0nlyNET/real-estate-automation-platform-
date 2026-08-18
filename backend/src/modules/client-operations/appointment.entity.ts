import {
  Column,
  Check,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Lead } from '../leads/lead.entity';
import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import {
  AppointmentMode,
  StoredBookingProvider,
} from '../calendar/booking-provider.types';
import { CalendarConnection } from '../calendar/calendar-connection.entity';

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show';

@Entity({ name: 'appointments' })
@Check(
  'CK_appointment_external_provider',
  '"external_provider" IS NULL OR "external_provider" IN (\'google\', \'microsoft\', \'calendly\')',
)
@Check(
  'CK_appointment_meeting_mode',
  '"meeting_mode" IN (\'in_person\', \'phone\', \'virtual\')',
)
@Index(['tenantId', 'status', 'startsAt'])
@Index(['assignedUserId', 'status', 'startsAt'])
@Index('IDX_appointment_external_event', ['tenantId', 'externalProvider', 'externalEventId'], {
  unique: true,
  where: 'external_event_id IS NOT NULL',
})
@Index('IDX_appointment_idempotency', ['tenantId', 'idempotencyKey'], {
  unique: true,
  where: 'idempotency_key IS NOT NULL',
})
@Index(
  'IDX_appointment_external_invitee',
  ['tenantId', 'externalProvider', 'externalInviteeId'],
  { where: 'external_invitee_id IS NOT NULL' },
)
@Index(
  'IDX_appointment_external_connection',
  ['externalConnectionId', 'syncStatus'],
  { where: 'external_connection_id IS NOT NULL' },
)
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

  @Column({ name: 'external_event_etag', type: 'text', nullable: true })
  externalEventEtag?: string | null;

  @Column({ name: 'external_provider', type: 'varchar', length: 30, nullable: true })
  externalProvider?: StoredBookingProvider | null;

  @Column({ name: 'external_calendar_id', type: 'text', nullable: true })
  externalCalendarId?: string | null;

  @Column({ name: 'external_connection_id', type: 'uuid', nullable: true })
  externalConnectionId?: string | null;

  @ManyToOne(() => CalendarConnection, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'external_connection_id' })
  externalConnection?: CalendarConnection | null;

  @Column({ name: 'external_invitee_id', type: 'text', nullable: true })
  externalInviteeId?: string | null;

  @Column({ name: 'external_join_url', type: 'text', nullable: true })
  externalJoinUrl?: string | null;

  @Column({ name: 'external_cancel_url', type: 'text', nullable: true })
  externalCancelUrl?: string | null;

  @Column({ name: 'external_reschedule_url', type: 'text', nullable: true })
  externalRescheduleUrl?: string | null;

  @Column({ name: 'external_provider_updated_at', type: 'timestamptz', nullable: true })
  externalProviderUpdatedAt?: Date | null;

  @Column({ name: 'meeting_mode', type: 'varchar', length: 20, default: 'in_person' })
  meetingMode!: AppointmentMode;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 160, nullable: true })
  idempotencyKey?: string | null;

  @Column({ name: 'sync_status', type: 'varchar', length: 30, default: 'not_synced' })
  syncStatus!: 'not_synced' | 'synced' | 'needs_attention';

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt?: Date | null;

  @Column({ name: 'sync_error_code', type: 'varchar', length: 100, nullable: true })
  syncErrorCode?: string | null;

  @Column({ name: 'post_commit_completed_at', type: 'timestamptz', nullable: true })
  postCommitCompletedAt?: Date | null;
}
