import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { UsagePolicyScope } from './usage-policy.entity';

export type UsageMetric = 'sms' | 'email' | 'ai' | 'lead';
export type UsageWindow = 'hour' | 'day';

@Entity({ name: 'usage_buckets' })
@Index(
  'UQ_usage_bucket_scope_metric_window',
  ['scopeType', 'scopeId', 'metric', 'windowType', 'windowStart'],
  { unique: true },
)
@Index('IDX_usage_bucket_scope_window', ['scopeType', 'scopeId', 'windowStart'])
export class UsageBucket extends BaseEntity {
  @Column({ name: 'scope_type', type: 'varchar', length: 20 })
  scopeType!: UsagePolicyScope;

  @Column({ name: 'scope_id', type: 'varchar', length: 64 })
  scopeId!: string;

  @Column({ type: 'varchar', length: 20 })
  metric!: UsageMetric;

  @Column({ name: 'window_type', type: 'varchar', length: 10 })
  windowType!: UsageWindow;

  @Column({ name: 'window_start', type: 'timestamptz' })
  windowStart!: Date;

  @Column({ type: 'int', default: 0 })
  quantity!: number;

  @Column({
    name: 'estimated_cost_usd',
    type: 'numeric',
    precision: 12,
    scale: 4,
    default: 0,
  })
  estimatedCostUsd!: string;
}
