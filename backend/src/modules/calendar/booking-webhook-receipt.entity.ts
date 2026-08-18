import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { StoredBookingProvider } from './booking-provider.types';

@Entity({ name: 'booking_webhook_receipts' })
@Check(
  'CK_booking_webhook_receipt_provider',
  '"provider" IN (\'google\', \'microsoft\', \'calendly\')',
)
@Index('UQ_booking_webhook_provider_event', ['tenantId', 'provider', 'eventKey'], {
  unique: true,
})
@Index('IDX_booking_webhook_tenant_received', ['tenantId', 'receivedAt'])
export class BookingWebhookReceipt extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  provider!: StoredBookingProvider;

  @Column({ name: 'event_key', type: 'varchar', length: 255 })
  eventKey!: string;

  @Column({ name: 'payload_hash', type: 'char', length: 64 })
  payloadHash!: string;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;
}
