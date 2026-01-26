import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ComplianceEventType =
  | 'sms_inbound_stop'
  | 'sms_blocked_opt_out'
  | 'sms_blocked_quiet_hours'
  | 'email_blocked_opt_out'
  | 'manual_opt_out_added'
  | 'manual_opt_out_removed';

@Entity('compliance_events')
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'eventType'])
export class ComplianceEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64 })
  eventType: ComplianceEventType;

  @Column({ type: 'varchar', length: 32, nullable: true })
  channel: 'sms' | 'email' | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  target: string | null;

  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'uuid', nullable: true })
  leadId: string | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  details: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
