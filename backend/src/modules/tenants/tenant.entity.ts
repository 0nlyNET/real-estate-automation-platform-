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

export type Plan = 'trial' | 'free' | 'pro' | 'teams' | 'enterprise';
export type TenantStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', nullable: true })
  name?: string | null;

  @Column({ type: 'text', default: 'trial' })
  plan!: Plan;

  @Column({ type: 'text', default: 'active' })
  status!: TenantStatus;

  @Column({ type: 'text', default: 'month' })
  billingInterval!: 'month' | 'year';

  @Column({ type: 'timestamptz', nullable: true })
  trialEndsAt?: Date | null;

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

  @Column({ type: 'text', nullable: true })
  stripePriceId?: string | null;

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
