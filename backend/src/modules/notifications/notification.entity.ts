import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type NotificationCategory =
  | 'leads'
  | 'clients'
  | 'onboarding'
  | 'billing'
  | 'tasks'
  | 'support'
  | 'integrations'
  | 'system';
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

@Entity({ name: 'admin_notifications' })
@Index(['recipientUserId', 'readAt', 'createdAt'])
@Index(['incidentKey', 'createdAt'])
@Index('IDX_admin_notification_dedupe', ['recipientUserId', 'deduplicationKey'], { unique: true })
export class AdminNotification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'recipient_user_id', type: 'uuid' })
  recipientUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipient_user_id' })
  recipient!: User;

  @Column({ name: 'event_type', type: 'varchar', length: 120 })
  eventType!: string;

  @Column({ type: 'varchar', length: 40 })
  category!: NotificationCategory;

  @Column({ type: 'varchar', length: 20, default: 'info' })
  severity!: NotificationSeverity;

  @Column({ type: 'varchar', length: 180 })
  title!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ name: 'action_url', type: 'varchar', length: 500, nullable: true })
  actionUrl?: string | null;

  @Column({ name: 'entity_type', type: 'varchar', length: 80, nullable: true })
  entityType?: string | null;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId?: string | null;

  @Column({ name: 'deduplication_key', type: 'varchar', length: 255 })
  deduplicationKey!: string;

  @Column({ name: 'incident_key', type: 'varchar', length: 255, nullable: true })
  incidentKey?: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, string | number | boolean | null>;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt?: Date | null;

  @Column({ name: 'push_delivery_status', type: 'varchar', length: 30, default: 'pending' })
  pushDeliveryStatus!: 'pending' | 'sent' | 'skipped' | 'failed';

  @Column({ name: 'push_sent_at', type: 'timestamptz', nullable: true })
  pushSentAt?: Date | null;

  @Column({ name: 'push_attempt_count', type: 'int', default: 0 })
  pushAttemptCount!: number;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
