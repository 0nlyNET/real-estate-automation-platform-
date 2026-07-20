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

@Entity({ name: 'admin_push_subscriptions' })
@Index(['recipientUserId', 'active'])
export class AdminPushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'recipient_user_id', type: 'uuid' })
  recipientUserId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'recipient_user_id' })
  recipient!: User;

  @Index({ unique: true })
  @Column({ type: 'text' })
  endpoint!: string;

  @Column({ name: 'p256dh_key', type: 'text' })
  p256dhKey!: string;

  @Column({ name: 'auth_key', type: 'text' })
  authKey!: string;

  @Column({ name: 'device_label', type: 'varchar', length: 120, nullable: true })
  deviceLabel?: string | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 500, nullable: true })
  userAgent?: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'last_success_at', type: 'timestamptz', nullable: true })
  lastSuccessAt?: Date | null;

  @Column({ name: 'last_failure_at', type: 'timestamptz', nullable: true })
  lastFailureAt?: Date | null;

  @Column({ name: 'failure_count', type: 'int', default: 0 })
  failureCount!: number;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
