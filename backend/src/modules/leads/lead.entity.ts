import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Tenant } from '../tenants/tenant.entity';
import { Message } from '../messaging/message.entity';
import { LeadEvent } from './lead-event.entity';
import { SequenceEnrollment } from '../sequences/sequence-enrollment.entity';
import { User } from '../users/user.entity';
import { Team } from '../teams/team.entity';
import { LeadHandoff } from '../client-operations/lead-handoff.entity';
import { Appointment } from '../client-operations/appointment.entity';

export type LeadType = 'buyer' | 'seller' | 'investor' | 'renter';
export type LeadTemperature = 'hot' | 'warm' | 'cold';
export type LeadReadiness = 'not_ready' | 'exploring' | 'ready' | 'urgent';
export type LeadCommunicationStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'opted_out';
export type LeadStage =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'appointment_set'
  | 'showing_scheduled'
  | 'offer_out'
  | 'under_contract'
  | 'closed'
  | 'nurture'
  | 'lost';

@Entity({ name: 'leads' })
@Index('IDX_leads_tenant_email', ['tenant', 'email'], {
  unique: true,
  where: 'email IS NOT NULL AND test_run_id IS NULL',
})
@Index('IDX_leads_tenant_phone', ['tenant', 'phone'], {
  unique: true,
  where: 'phone IS NOT NULL AND test_run_id IS NULL',
})
@Index('IDX_leads_tenant_test_run', ['tenantId', 'testRunId'], {
  unique: true,
  where: 'test_run_id IS NOT NULL',
})
@Index(
  'IDX_leads_tenant_provider_lead',
  ['tenantId', 'provider', 'providerLeadId'],
  {
    unique: true,
    where: '"provider_lead_id" IS NOT NULL AND "provider" IS NOT NULL',
  },
)
export class Lead extends BaseEntity {
  @Index()
  @Column({ name: 'test_run_id', type: 'uuid', nullable: true })
  testRunId?: string | null;

  @Column({ name: 'full_name' })
  fullName!: string;

  // Agent-friendly pipeline stage (MVP)
  @Column({ name: 'stage', type: 'varchar', default: 'new' })
  stage!: LeadStage;

  // Simple lead score (0-100). Higher = more likely to convert.
  @Column({ name: 'score', type: 'int', default: 50 })
  score!: number;

  // Speed-to-lead metrics
  @Column({ name: 'first_contact_sent_at', type: 'timestamptz', nullable: true })
  firstContactSentAt?: Date | null;

  @Column({ name: 'first_response_received_at', type: 'timestamptz', nullable: true })
  firstResponseReceivedAt?: Date | null;

  @Column({ name: 'first_response_time_sec', type: 'int', nullable: true })
  firstResponseTimeSec?: number | null;

  // Qualification fields (MVP)
  @Column({ name: 'timeline', type: 'varchar', nullable: true })
  timeline?: string | null;

  @Column({ name: 'buy_or_rent', type: 'varchar', nullable: true })
  buyOrRent?: 'buy' | 'rent' | 'sell' | null;

  @Column({ name: 'preapproved', type: 'varchar', nullable: true })
  preapproved?: 'yes' | 'no' | 'unsure' | null;

  @Column({ name: 'best_time_to_talk', type: 'varchar', nullable: true })
  bestTimeToTalk?: string | null;

  @Column({ name: 'tags', type: 'simple-array', nullable: true })
  tags?: string[] | null;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  source?: string;

  @Column({ name: 'provider', type: 'varchar', length: 30, nullable: true })
  provider?: 'zillow' | 'realtor' | null;

  @Column({
    name: 'provider_lead_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  providerLeadId?: string | null;

  @Column({ name: 'ingestion_provider', type: 'varchar', length: 40, nullable: true })
  ingestionProvider?: string | null;

  @Column({ name: 'source_system', type: 'varchar', length: 80, nullable: true })
  sourceSystem?: string | null;

  @Column({ name: 'original_source', type: 'varchar', length: 160, nullable: true })
  originalSource?: string | null;

  @Column({ name: 'external_lead_id', type: 'varchar', length: 255, nullable: true })
  externalLeadId?: string | null;

  @Column({
    name: 'ingestion_fingerprint',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  ingestionFingerprint?: string | null;

  @Column({
    name: 'communication_status',
    type: 'varchar',
    length: 30,
    default: 'active',
  })
  communicationStatus!: LeadCommunicationStatus;

  @Column({ name: 'opted_out_at', type: 'timestamptz', nullable: true })
  optedOutAt?: Date | null;

  @Column({
    name: 'opt_out_source',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  optOutSource?: string | null;

  @Column({ name: 'sms_eligible', type: 'boolean', default: false })
  smsEligible!: boolean;

  @Column({ name: 'email_eligible', type: 'boolean', default: false })
  emailEligible!: boolean;

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

  @Column({ name: 'next_follow_up_at', type: 'timestamptz', nullable: true })
  nextFollowUpAt?: Date;

  @Column({ name: 'lead_type', type: 'varchar', default: 'buyer' })
  leadType!: LeadType;

  @Column({ name: 'temperature', type: 'varchar', default: 'warm' })
  temperature!: LeadTemperature;

  @Column({
    name: 'temperature_reason',
    type: 'text',
    default: 'Needs more qualification before the next step.',
  })
  temperatureReason!: string;

  @Column({ name: 'readiness_level', type: 'varchar', default: 'exploring' })
  readinessLevel!: LeadReadiness;

  @Column({ name: 'main_blocker', type: 'varchar', nullable: true })
  mainBlocker?: string | null;

  @Column({ name: 'next_milestone', type: 'varchar', nullable: true })
  nextMilestone?: string | null;

  @Column({ name: 'recommended_next_action', type: 'varchar', nullable: true })
  recommendedNextAction?: string | null;

  @Column({ name: 'follow_up_cadence', type: 'varchar', nullable: true })
  followUpCadence?: string | null;

  @Column({ name: 'qualification_data', type: 'jsonb', default: () => "'{}'::jsonb" })
  qualificationData!: Record<string, string | boolean | number | null>;

  @Column({ name: 'conversation_summary', type: 'text', nullable: true })
  conversationSummary?: string | null;

  @Column({ name: 'recommended_talking_points', type: 'simple-array', nullable: true })
  recommendedTalkingPoints?: string[] | null;

  @Column({ name: 'outcome', type: 'varchar', nullable: true })
  outcome?: string | null;

  // Back-compat field (older UI used a string). Keep it as optional label.
  @Column({ name: 'assigned_to', nullable: true })
  assignedTo?: string;

  // Proper assignment for Teams/Brokerages.
  @Column({ name: 'assigned_to_user_id', type: 'uuid', nullable: true })
  assignedToUserId?: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_to_user_id' })
  assignedToUser?: User | null;

  @Column({ name: 'assigned_to_team_id', type: 'uuid', nullable: true })
  assignedToTeamId?: string | null;

  @ManyToOne(() => Team, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_to_team_id' })
  assignedToTeam?: Team | null;

  @Column({ name: 'sequence_status', default: 'idle' })
  sequenceStatus!: 'idle' | 'active' | 'stopped';

  @ManyToOne(() => Tenant, (tenant) => tenant.leads)
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @OneToMany(() => Message, (message) => message.lead)
  messages!: Message[];

  @OneToMany(() => LeadEvent, (event) => event.lead)
  events!: LeadEvent[];

  @OneToMany(() => SequenceEnrollment, (enrollment) => enrollment.lead)
  enrollments!: SequenceEnrollment[];

  @OneToMany(() => LeadHandoff, (handoff) => handoff.lead)
  handoffs!: LeadHandoff[];

  @OneToMany(() => Appointment, (appointment) => appointment.lead)
  appointments!: Appointment[];
}
