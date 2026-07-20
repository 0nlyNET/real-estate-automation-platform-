import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity({ name: 'admin_notification_preferences' })
export class AdminNotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'recipient_user_id', type: 'uuid' })
  recipientUserId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipient_user_id' })
  recipient!: User;

  @Column({ name: 'in_app_enabled', type: 'boolean', default: true })
  inAppEnabled!: boolean;

  @Column({ name: 'push_enabled', type: 'boolean', default: true })
  pushEnabled!: boolean;

  @Column({ name: 'email_enabled', type: 'boolean', default: false })
  emailEnabled!: boolean;

  @Column({ name: 'privacy_mode', type: 'boolean', default: true })
  privacyMode!: boolean;

  @Column({ name: 'category_settings', type: 'jsonb', default: () => "'{}'::jsonb" })
  categorySettings!: Record<string, boolean>;

  @Column({ name: 'severity_settings', type: 'jsonb', default: () => "'{}'::jsonb" })
  severitySettings!: Record<string, boolean>;

  @Column({ name: 'quiet_hours_enabled', type: 'boolean', default: false })
  quietHoursEnabled!: boolean;

  @Column({ name: 'quiet_hours_start', type: 'varchar', length: 5, default: '21:00' })
  quietHoursStart!: string;

  @Column({ name: 'quiet_hours_end', type: 'varchar', length: 5, default: '08:00' })
  quietHoursEnd!: string;

  @Column({ type: 'varchar', length: 100, default: 'America/New_York' })
  timezone!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
