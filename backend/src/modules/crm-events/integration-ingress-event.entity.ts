import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'integration_ingress_events' })
@Index('UQ_integration_ingress_event_external', ['connectionId', 'externalEventId'], { unique: true })
@Index('IDX_integration_ingress_event_tenant', ['tenantId', 'createdAt'])
export class IntegrationIngressEvent extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ name: 'external_event_id', type: 'varchar', length: 255 })
  externalEventId!: string;

  @Column({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'processing' })
  status!: 'processing' | 'accepted' | 'failed';

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  attribution!: Record<string, unknown>;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;
}
