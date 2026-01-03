import { Column, Entity, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Lead } from '../leads/lead.entity';

export type MessageDirection = 'inbound' | 'outbound';

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
}
