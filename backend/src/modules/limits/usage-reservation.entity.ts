import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { UsageMetric } from './usage-bucket.entity';

@Entity({ name: 'usage_reservations' })
@Index('UQ_usage_reservation_idempotency', ['idempotencyKey'], { unique: true })
@Index('IDX_usage_reservation_tenant_created', ['tenantId', 'createdAt'])
export class UsageReservation extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255 })
  idempotencyKey!: string;

  @Column({ type: 'varchar', length: 20 })
  metric!: UsageMetric;

  @Column({ type: 'int', default: 1 })
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
