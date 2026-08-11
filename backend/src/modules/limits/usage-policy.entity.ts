import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

export type UsagePolicyScope = 'tenant' | 'platform';

@Entity({ name: 'usage_policies' })
@Index('UQ_usage_policy_scope', ['scopeType', 'scopeId'], { unique: true })
export class UsagePolicy extends BaseEntity {
  @Column({ name: 'scope_type', type: 'varchar', length: 20 })
  scopeType!: UsagePolicyScope;

  @Column({ name: 'scope_id', type: 'varchar', length: 64 })
  scopeId!: string;

  @Column({ name: 'max_sms_per_hour', type: 'int' })
  maxSmsPerHour!: number;

  @Column({ name: 'max_sms_per_day', type: 'int' })
  maxSmsPerDay!: number;

  @Column({ name: 'max_emails_per_hour', type: 'int' })
  maxEmailsPerHour!: number;

  @Column({ name: 'max_emails_per_day', type: 'int' })
  maxEmailsPerDay!: number;

  @Column({ name: 'max_ai_calls_per_day', type: 'int' })
  maxAiCallsPerDay!: number;

  @Column({ name: 'max_leads_per_hour', type: 'int' })
  maxLeadsPerHour!: number;

  @Column({ name: 'warning_percentage', type: 'int', default: 80 })
  warningPercentage!: number;

  @Column({
    name: 'warning_cost_threshold_usd',
    type: 'numeric',
    precision: 12,
    scale: 4,
  })
  warningCostThresholdUsd!: string;

  @Column({
    name: 'hard_cost_threshold_usd',
    type: 'numeric',
    precision: 12,
    scale: 4,
  })
  hardCostThresholdUsd!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;
}
