import { Column, Entity, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Lead } from '../leads/lead.entity';

export type MessageDirection = 'inbound' | 'outbound';

export type MessageStatus =
  | 'created'
  | 'queued'
  | 'sending'
  | 'provider_accepted'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'received'
  | 'skipped'
  | 'canceled'
  // Legacy values remain readable while the readiness migration normalizes them.
  | 'pending'
  | 'scheduled';

@Entity({ name: 'messages' })
export class Message extends BaseEntity {
  // DB column is camelCase: "leadId"
  @Column({ name: 'leadId', type: 'uuid' })
  leadId!: string;

  @ManyToOne(() => Lead, (lead) => lead.messages)
  @JoinColumn({ name: 'leadId' })
  lead!: Lead;

  @Column({ name: 'channel' })
  channel!: 'sms' | 'email';

  @Column({ name: 'direction', type: 'varchar' })
  direction!: MessageDirection;

  @Column({ name: 'body', type: 'text' })
  body!: string;

  @Column({ name: 'provider_message_id', nullable: true })
  @Index('IDX_messages_provider_message_id', {
    unique: true,
    where: '"provider_message_id" IS NOT NULL',
  })
  providerMessageId?: string;

  @Column({ name: 'status', type: 'varchar', default: 'pending' })
  status!: MessageStatus;

  @Column({ name: 'provider_status', type: 'varchar', nullable: true })
  providerStatus?: string | null;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt?: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date;

  @Column({ name: 'provider_accepted_at', type: 'timestamptz', nullable: true })
  providerAcceptedAt?: Date | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt?: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt?: Date | null;

  @Column({ name: 'canceled_at', type: 'timestamptz', nullable: true })
  canceledAt?: Date | null;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string;

  @Column({ name: 'error_code', type: 'varchar', nullable: true })
  errorCode?: string | null;

  @Column({ name: 'sanitized_error_message', type: 'text', nullable: true })
  sanitizedErrorMessage?: string | null;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    default: () => 'gen_random_uuid()::text',
  })
  @Index('IDX_messages_idempotency_key', { unique: true })
  idempotencyKey!: string;

  @Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
  lockedAt?: Date | null;

  @Column({ name: 'locked_by', type: 'varchar', nullable: true })
  lockedBy?: string | null;

  @Column({ name: 'last_attempted_at', type: 'timestamptz', nullable: true })
  lastAttemptedAt?: Date | null;

  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt?: Date | null;
}
