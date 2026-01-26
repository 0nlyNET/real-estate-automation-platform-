import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type ComplianceChannel = 'sms' | 'email';

@Entity('compliance_optouts')
@Index(['tenantId', 'channel', 'value'], { unique: true })
export class ComplianceOptOut {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  channel: ComplianceChannel;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'text', default: 'user_request' })
  reason: string;

  @Column({ type: 'text', default: 'manual' })
  source: string;

  @CreateDateColumn()
  createdAt: Date;
}
