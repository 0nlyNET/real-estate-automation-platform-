import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'prospect_applications' })
@Index(['status', 'createdAt'])
export class ProspectApplication {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  phone?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  company?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  website?: string | null;

  @Column({ name: 'estimated_monthly_lead_volume', type: 'int', nullable: true })
  estimatedMonthlyLeadVolume?: number | null;

  @Column({ name: 'requested_service', type: 'varchar', length: 120, nullable: true })
  requestedService?: string | null;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'varchar', length: 255, default: 'website' })
  source!: string;

  @Column({ type: 'varchar', length: 50, default: 'new' })
  status!: 'new' | 'reviewing' | 'qualified' | 'consultation_booked' | 'accepted' | 'declined';

  @Column({ name: 'assigned_operator_id', type: 'uuid', nullable: true })
  assignedOperatorId?: string | null;

  @Column({ name: 'operator_notes', type: 'text', nullable: true })
  operatorNotes?: string | null;

  @Column({ name: 'notification_status', type: 'varchar', length: 50, default: 'pending' })
  notificationStatus!: 'pending' | 'sent' | 'partial' | 'failed';

  @Column({ name: 'notification_error', type: 'text', nullable: true })
  notificationError?: string | null;

  @Index({ unique: true })
  @Column({ name: 'converted_tenant_id', type: 'uuid', nullable: true })
  convertedTenantId?: string | null;

  @Column({ name: 'conversion_status', default: 'not_started' })
  conversionStatus!: 'not_started' | 'created' | 'failed';

  @Column({ name: 'converted_at', type: 'timestamptz', nullable: true })
  convertedAt?: Date | null;

  @Column({ name: 'conversion_error', type: 'text', nullable: true })
  conversionError?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
