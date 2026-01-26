import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('compliance_events')
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'type'])
export class ComplianceEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'text', nullable: true })
  channel: string | null;

  @Column({ type: 'uuid', nullable: true })
  leadId: string | null;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'uuid', nullable: true })
  messageId: string | null;

  @Column({ type: 'text', nullable: true })
  to: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: any | null;

  @CreateDateColumn()
  createdAt: Date;
}
