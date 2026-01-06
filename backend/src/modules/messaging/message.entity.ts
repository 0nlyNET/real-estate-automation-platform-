import { Column, Entity, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Lead } from '../leads/lead.entity';

export type MessageDirection = 'inbound' | 'outbound';

export type MessageStatus =
  | 'pending'
  | 'scheduled'
  | 'sent'
  | 'failed'
  | 'received'
  | 'skipped';

@Entity({ name: 'messages' })
export class Message extends BaseEntity {
  @ManyToOne(() => Lead, (lead) => lead.events)
  lead!: Lead;

  @Column({ name: 'channel' })
  channel!: 'sms' | 'email';

  @Column({ name: 'direction', type: 'varchar' })
  direction!: MessageDirection;

  @Column({ name: 'body', type: 'text' })
  body!: string;

  @Column({ name: 'provider_message_id', nullable: true })
  providerMessageId?: string;

  @Column({ name: 'status', type: 'varchar', default: 'pending' })
  status!: MessageStatus;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt?: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string;
}
