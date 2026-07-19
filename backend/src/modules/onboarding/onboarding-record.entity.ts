import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'onboarding_records' })
export class OnboardingRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'business_identity', type: 'jsonb', default: () => "'{}'::jsonb" })
  businessIdentity!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  contacts!: Record<string, unknown>;

  @Column({ name: 'service_scope', type: 'jsonb', default: () => "'{}'::jsonb" })
  serviceScope!: Record<string, unknown>;

  @Column({ name: 'lead_handling', type: 'jsonb', default: () => "'{}'::jsonb" })
  leadHandling!: Record<string, unknown>;

  @Column({ name: 'brand_communication', type: 'jsonb', default: () => "'{}'::jsonb" })
  brandCommunication!: Record<string, unknown>;

  @Column({ name: 'consent_configuration', type: 'jsonb', default: () => "'{}'::jsonb" })
  consentConfiguration!: Record<string, unknown>;

  @Column({ name: 'integration_configuration', type: 'jsonb', default: () => "'{}'::jsonb" })
  integrationConfiguration!: Record<string, unknown>;

  @Column({ name: 'provider_tests', type: 'jsonb', default: () => "'{}'::jsonb" })
  providerTests!: Record<string, unknown>;

  @Column({ name: 'verified_items', type: 'jsonb', default: () => "'{}'::jsonb" })
  verifiedItems!: Record<string, unknown>;

  @Column({ name: 'sms_enabled', type: 'boolean', default: false })
  smsEnabled!: boolean;

  @Column({ name: 'email_enabled', type: 'boolean', default: false })
  emailEnabled!: boolean;

  @Column({ name: 'booking_enabled', type: 'boolean', default: false })
  bookingEnabled!: boolean;

  @Column({ name: 'consent_policy_acknowledged_at', type: 'timestamptz', nullable: true })
  consentPolicyAcknowledgedAt?: Date | null;

  @Column({ name: 'test_lead_completed_at', type: 'timestamptz', nullable: true })
  testLeadCompletedAt?: Date | null;

  @Column({ name: 'inbound_sms_tested_at', type: 'timestamptz', nullable: true })
  inboundSmsTestedAt?: Date | null;

  @Column({ name: 'stop_tested_at', type: 'timestamptz', nullable: true })
  stopTestedAt?: Date | null;

  @Column({ name: 'provider_rejection_tested_at', type: 'timestamptz', nullable: true })
  providerRejectionTestedAt?: Date | null;

  @Column({ name: 'billing_verified_at', type: 'timestamptz', nullable: true })
  billingVerifiedAt?: Date | null;

  @Column({ name: 'client_approved_at', type: 'timestamptz', nullable: true })
  clientApprovedAt?: Date | null;

  @Column({ name: 'client_approval_evidence', type: 'text', nullable: true })
  clientApprovalEvidence?: string | null;

  @Column({ name: 'operator_approved_by_id', type: 'uuid', nullable: true })
  operatorApprovedById?: string | null;

  @Column({ name: 'operator_approved_at', type: 'timestamptz', nullable: true })
  operatorApprovedAt?: Date | null;

  @Column({ name: 'activation_status', type: 'varchar', length: 40, default: 'incomplete' })
  activationStatus!: 'incomplete' | 'blocked' | 'ready' | 'active' | 'paused';

  @Column({ name: 'blocked_reason', type: 'text', nullable: true })
  blockedReason?: string | null;

  @Column({ name: 'target_launch_date', type: 'date', nullable: true })
  targetLaunchDate?: string | null;

  @Column({ name: 'assigned_onboarding_owner_id', type: 'uuid', nullable: true })
  assignedOnboardingOwnerId?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
