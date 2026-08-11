import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'tenant_webhook_subscriptions' })
@Index('IDX_tenant_webhook_subscription_event', ['tenantId', 'eventType', 'status'])
export class TenantWebhookSubscription extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 80 })
  eventType!: string;

  @Column({ name: 'target_url', type: 'varchar', length: 2048 })
  targetUrl!: string;

  @Column({ name: 'encrypted_signing_secret', type: 'text' })
  encryptedSigningSecret!: string;

  @Column({ name: 'secret_last4', type: 'varchar', length: 4 })
  secretLast4!: string;

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: 'active' | 'paused' | 'revoked';

  @Column({ name: 'failure_count', type: 'integer', default: 0 })
  failureCount!: number;

  @Column({ name: 'last_success_at', type: 'timestamptz', nullable: true })
  lastSuccessAt!: Date | null;

  @Column({ name: 'last_failure_at', type: 'timestamptz', nullable: true })
  lastFailureAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;
}
