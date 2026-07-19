import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'stripe_webhook_events' })
export class StripeWebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'stripe_event_id', type: 'varchar', length: 255 })
  stripeEventId!: string;

  @Index()
  @Column({ name: 'event_type', type: 'varchar', length: 255 })
  eventType!: string;

  @Column({ name: 'api_version', type: 'varchar', length: 50, nullable: true })
  apiVersion?: string | null;

  @Column({ name: 'stripe_created_at', type: 'timestamptz', nullable: true })
  stripeCreatedAt?: Date | null;

  @Index()
  @Column({ name: 'processing_status', type: 'varchar', length: 30, default: 'received' })
  processingStatus!: 'received' | 'processing' | 'completed' | 'failed';

  @Column({ name: 'processing_started_at', type: 'timestamptz', nullable: true })
  processingStartedAt?: Date | null;

  @Column({ name: 'processing_completed_at', type: 'timestamptz', nullable: true })
  processingCompletedAt?: Date | null;

  @Column({ name: 'error_summary', type: 'text', nullable: true })
  errorSummary?: string | null;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null;

  @Column({ name: 'stripe_customer_id', type: 'varchar', nullable: true })
  stripeCustomerId?: string | null;

  @Column({ name: 'stripe_subscription_id', type: 'varchar', nullable: true })
  stripeSubscriptionId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
