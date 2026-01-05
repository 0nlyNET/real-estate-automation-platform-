import { Column, Entity, Index, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Tenants } from '../tenants/tenant.entity';
import { LeadEvent } from './lead-event.entity';
import { SequenceEnrollment } from '../sequences/sequence-enrollment.entity';

export type LeadType = 'buyer' | 'seller' | 'investor' | 'renter';
export type LeadTemperature = 'hot' | 'warm' | 'cold';
export type LeadStage =
  | 'new'
  | 'active'
  | 'hot'
  | 'under_contract'
  | 'closed'
  | 'lost';

@Entity({ name: 'leads' })
@Index(['tenant', 'email'], { unique: true, where: 'email IS NOT NULL' })
@Index(['tenant', 'phone'], { unique: true, where: 'phone IS NOT NULL' })
export class Lead extends BaseEntity {
  @Column({ name: 'full_name' })
  fullName!: string;

  // Agent-friendly pipeline stage (MVP)
  @Column({ name: 'stage', type: 'varchar', default: 'new' })
  stage!: LeadStage;

  // Simple lead score (0-100). Higher = more likely to convert.
  @Column({ name: 'score', type: 'int', default: 50 })
  score!: number;

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

  @Column({ name: 'budget_range', nullable: true })
  budgetRange?: string;

  @Column({ name: 'estimated_price', nullable: true })
  estimatedPrice?: string;

  @Column({ name: 'preferred_areas', type: 'simple-array', nullable: true })
  preferredAreas?: string[];

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes?: string;

  @Column({ name: 'last_activity_at', type: 'timestamptz', nullable: true })
  lastActivityAt?: Date;

  @Column({ name: 'last_contacted_at', type: 'timestamptz', nullable: true })
  lastContactedAt?: Date;

  // Placeholder for “Follow-ups due” in the UI. Later: derive from sequences.
  @Column({ name: 'next_follow_up_at', type: 'timestamptz', nullable: true })
  nextFollowUpAt?: Date;

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
