import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Tenants } from '../tenants/tenant.entity';
import { LeadEvent } from './lead-event.entity';
import { SequenceEnrollment } from '../sequences/sequence-enrollment.entity';

export type LeadType = 'buyer' | 'seller' | 'investor' | 'renter';
export type LeadTemperature = 'hot' | 'warm' | 'cold';

@Entity({ name: 'leads' })
@Index(['tenant', 'email'], { unique: true, where: 'email IS NOT NULL' })
@Index(['tenant', 'phone'], { unique: true, where: 'phone IS NOT NULL' })
export class Lead extends BaseEntity {
  @Column({ name: 'full_name' })
  fullName!: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  source?: string;

  @Column({ nullable: true })
  location?: string;

  @Column({ name: 'property_interest', nullable: true })
  propertyInterest?: string;

  @Column({ name: 'lead_type', type: 'varchar', default: 'buyer' })
  leadType!: LeadType;

  @Column({ name: 'temperature', type: 'varchar', default: 'warm' })
  temperature!: LeadTemperature;

  @Column({ name: 'assigned_to', nullable: true })
  assignedTo?: string;

  @Column({ name: 'sequence_status', default: 'idle' })
  sequenceStatus!: 'idle' | 'active' | 'stopped';

  @ManyToOne(() => Tenants, (tenant) => tenant.leads)
  tenant!: Tenants;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @OneToMany(() => LeadEvent, (event) => event.lead)
  events!: LeadEvent[];

  @OneToMany(() => SequenceEnrollment, (enrollment) => enrollment.lead)
  enrollments!: SequenceEnrollment[];
}
