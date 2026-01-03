import { Column, Entity, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Lead } from './lead.entity';

@Entity({ name: 'lead_events' })
export class LeadEvent extends BaseEntity {
  @ManyToOne(() => Lead, (lead) => lead.events)
  lead!: Lead;

  @Column({ name: 'event_type' })
  eventType!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
