import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type NotificationIncidentStatus = 'open' | 'escalated' | 'recovered' | 'resolved';

/**
 * Tracks a deduplicated operational incident (e.g. provider repeatedly
 * failing) so notification email follows the failure → warn → escalate →
 * single-recovery lifecycle instead of spamming one email per failure.
 */
@Entity({ name: 'notification_incidents' })
export class NotificationIncident {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'incident_key', type: 'varchar', length: 255 })
  incidentKey!: string;

  @Column({ type: 'varchar', length: 20, default: 'open' })
  status!: NotificationIncidentStatus;

  @Column({ name: 'failure_count', type: 'int', default: 0 })
  failureCount!: number;

  @Column({ name: 'first_failure_at', type: 'timestamptz', nullable: true })
  firstFailureAt?: Date | null;

  @Column({ name: 'last_failure_at', type: 'timestamptz', nullable: true })
  lastFailureAt?: Date | null;

  @Column({ name: 'last_notified_severity', type: 'varchar', length: 20, nullable: true })
  lastNotifiedSeverity?: string | null;

  @Column({ name: 'last_notified_at', type: 'timestamptz', nullable: true })
  lastNotifiedAt?: Date | null;

  @Column({ name: 'recovered_at', type: 'timestamptz', nullable: true })
  recoveredAt?: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, string | number | boolean | null>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
