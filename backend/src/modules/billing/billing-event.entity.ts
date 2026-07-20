import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';

@Entity({ name: 'billing_events' })
@Index(['livemode', 'eventType', 'occurredAt'])
@Index(['tenantId', 'occurredAt'])
export class BillingEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'provider_event_id', type: 'varchar', length: 255 })
  providerEventId!: string;

  @Column({ name: 'tenant_id', type: 'uuid', nullable: true })
  tenantId?: string | null;

  @ManyToOne(() => Tenant, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant | null;

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType!: 'invoice_paid' | 'payment_failed' | 'refund' | 'dispute' | 'subscription_canceled';

  @Column({ name: 'invoice_id', type: 'varchar', length: 255, nullable: true })
  invoiceId?: string | null;

  @Column({ name: 'charge_id', type: 'varchar', length: 255, nullable: true })
  chargeId?: string | null;

  @Column({ name: 'amount_cents', type: 'bigint', default: 0 })
  amountCents!: number;

  @Column({ type: 'varchar', length: 3, default: 'usd' })
  currency!: string;

  @Column({ type: 'boolean', default: false })
  livemode!: boolean;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
