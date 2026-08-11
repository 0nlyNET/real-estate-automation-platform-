import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SuppressionChannel = 'sms' | 'email';

@Entity('communication_suppressions')
@Index(['tenantId', 'channel', 'value'], { unique: true })
export class CommunicationSuppression {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 20 })
  channel: SuppressionChannel;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'varchar', length: 80 })
  reason: string;

  @Column({ type: 'varchar', length: 80 })
  source: string;

  @Column({ type: 'boolean', default: true })
  permanent: boolean;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'last_observed_at', type: 'timestamptz' })
  lastObservedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
