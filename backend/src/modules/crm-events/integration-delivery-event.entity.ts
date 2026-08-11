import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'integration_delivery_events' })
@Index('UQ_integration_delivery_event_subscription_event', ['subscriptionId', 'eventId'], { unique: true })
@Index('IDX_integration_delivery_event_tenant_status', ['tenantId', 'status'])
export class IntegrationDeliveryEvent extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'subscription_id', type: 'uuid' })
  subscriptionId!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 30, default: 'scheduled' })
  status!: 'scheduled' | 'delivering' | 'delivered' | 'failed';

  @Column({ name: 'attempt_count', type: 'integer', default: 0 })
  attemptCount!: number;

  @Column({ name: 'last_http_status', type: 'integer', nullable: true })
  lastHttpStatus!: number | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;
}
