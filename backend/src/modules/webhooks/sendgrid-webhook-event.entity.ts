import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'sendgrid_webhook_events' })
@Index('UQ_sendgrid_webhook_event_id', ['providerEventId'], { unique: true })
@Index('IDX_sendgrid_webhook_message_created', ['messageId', 'createdAt'])
export class SendGridWebhookEvent extends BaseEntity {
  @Column({ name: 'provider_event_id', type: 'varchar', length: 255 })
  providerEventId!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null;

  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId?: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType!: string;

  @Column({ name: 'provider_message_id', type: 'varchar', length: 500, nullable: true })
  providerMessageId?: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz', nullable: true })
  occurredAt?: Date | null;

  @Column({ name: 'processing_result', type: 'varchar', length: 50 })
  processingResult!: 'updated' | 'ignored';

  @Column({ name: 'payload_metadata', type: 'jsonb', default: () => "'{}'::jsonb" })
  payloadMetadata!: Record<string, unknown>;
}
