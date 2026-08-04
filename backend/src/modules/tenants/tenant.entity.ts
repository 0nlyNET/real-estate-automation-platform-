import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity';
import { Lead } from '../leads/lead.entity';
import { Credential } from '../settings/credential.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';

// `pro`, `teams`, and `enterprise` remain readable for legacy rows only.
// New paid subscriptions are normalized to the single managed service.
export type Plan =
  | 'trial'
  | 'free'
  | 'service'
  | 'pro'
  | 'teams'
  | 'enterprise';
export type TenantStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

export type WorkspaceLifecycleStatus =
  | 'DRAFT'
  | 'ONBOARDING'
  | 'READY_FOR_UAT'
  | 'UAT_FAILED'
  | 'READY_FOR_ACTIVATION'
  | 'ACTIVE'
  | 'PAUSED'
  | 'SUSPENDED'
  | 'CANCELED';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', nullable: true })
  name?: string | null;

  @Column({ type: 'text', default: 'trial' })
  plan!: Plan;

  @Column({ type: 'text', default: 'incomplete' })
  status!: TenantStatus;

  @Column({ name: 'lifecycle_status', type: 'text', default: 'ONBOARDING' })
  lifecycleStatus!: WorkspaceLifecycleStatus;

  @Column({ name: 'service_activated_at', type: 'timestamptz', nullable: true })
  serviceActivatedAt?: Date | null;

  @Column({ name: 'service_paused_at', type: 'timestamptz', nullable: true })
  servicePausedAt?: Date | null;

  @Column({ name: 'service_suspended_at', type: 'timestamptz', nullable: true })
  serviceSuspendedAt?: Date | null;

  @Column({ name: 'service_suspension_reason', type: 'text', nullable: true })
  serviceSuspensionReason?: string | null;

  @Column({ name: 'service_suspension_source', type: 'varchar', length: 30, nullable: true })
  serviceSuspensionSource?: 'manual' | 'billing' | null;

  @Column({ name: 'service_suspended_by_id', type: 'uuid', nullable: true })
  serviceSuspendedById?: string | null;

  @Column({ name: 'service_previous_lifecycle_status', type: 'varchar', length: 40, nullable: true })
  servicePreviousLifecycleStatus?: WorkspaceLifecycleStatus | null;

  @Column({ name: 'service_restored_at', type: 'timestamptz', nullable: true })
  serviceRestoredAt?: Date | null;

  @Column({ name: 'service_restored_by_id', type: 'uuid', nullable: true })
  serviceRestoredById?: string | null;

  @Column({ type: 'text', default: 'month' })
  billingInterval!: 'month' | 'year';

  @Column({ type: 'timestamptz', nullable: true })
  trialEndsAt?: Date | null;

  @Column({ name: 'trial_start', type: 'timestamptz', nullable: true })
  trialStart?: Date | null;

  @Column({ name: 'current_period_start', type: 'timestamptz', nullable: true })
  currentPeriodStart?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodEnd?: Date | null;

  @Column({ type: 'boolean', default: false })
  cancelAtPeriodEnd!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  cancelAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  stripeCustomerId?: string | null;

  @Column({ type: 'text', nullable: true })
  stripeSubscriptionId?: string | null;

  @Column({ type: 'text', nullable: true })
  stripeSubscriptionStatus?: string | null;

  @Column({ name: 'stripe_checkout_session_id', type: 'text', nullable: true })
  stripeCheckoutSessionId?: string | null;

  @Column({ name: 'stripe_checkout_started_at', type: 'timestamptz', nullable: true })
  stripeCheckoutStartedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  stripePriceId?: string | null;

  @Column({ name: 'stripe_product_id', type: 'text', nullable: true })
  stripeProductId?: string | null;

  @Column({ name: 'cancellation_date', type: 'timestamptz', nullable: true })
  cancellationDate?: Date | null;

  @Column({ name: 'canceled_at', type: 'timestamptz', nullable: true })
  canceledAt?: Date | null;

  @Column({ name: 'latest_invoice_id', type: 'text', nullable: true })
  latestInvoiceId?: string | null;

  @Column({ name: 'last_payment_failure_at', type: 'timestamptz', nullable: true })
  lastPaymentFailureAt?: Date | null;

  @Column({ name: 'setup_paid_at', type: 'timestamptz', nullable: true })
  setupPaidAt?: Date | null;

  @Column({ name: 'setup_invoice_id', type: 'text', nullable: true })
  setupInvoiceId?: string | null;

  @Column({ name: 'setup_stripe_price_id', type: 'text', nullable: true })
  setupStripePriceId?: string | null;

  @Column({ name: 'billing_state_updated_at', type: 'timestamptz', nullable: true })
  billingStateUpdatedAt?: Date | null;

  @Column({ name: 'assigned_operator_id', type: 'uuid', nullable: true })
  assignedOperatorId?: string | null;

  @Column({ name: 'stripe_unit_amount', type: 'int', nullable: true })
  stripeUnitAmount?: number | null;

  @Column({ name: 'stripe_currency', type: 'varchar', length: 3, nullable: true })
  stripeCurrency?: string | null;

  @Column({ name: 'stripe_recurring_interval', type: 'varchar', length: 10, nullable: true })
  stripeRecurringInterval?: 'month' | 'year' | null;

  // App settings referenced by messaging logic
  @Column({ type: 'text', nullable: true })
  bookingLink?: string | null;

  @Column({ type: 'text', default: 'America/New_York' })
  timezone!: string;

  @Column({ type: 'text', nullable: true })
  quietHoursStart?: string | null;

  @Column({ type: 'text', nullable: true })
  quietHoursEnd?: string | null;

  @OneToMany(() => User, (u) => u.tenant)
  users!: User[];

  @OneToMany(() => Lead, (l) => l.tenant)
  leads!: Lead[];

  @OneToMany(() => Credential, (c) => c.tenant)
  credentials!: Credential[];

  // TenantSettings has tenantId, not a "tenant" relation property
  @OneToOne(() => TenantSettings, (s) => s.tenantId)
  settings?: TenantSettings;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
