import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { StoredBookingProvider } from './booking-provider.types';

export type CalendarConnectionStatus =
  | 'configured'
  | 'connected'
  | 'needs_attention'
  | 'disconnected';

@Entity({ name: 'calendar_connections' })
@Check(
  'CK_calendar_connection_provider',
  '"provider" IN (\'google\', \'microsoft\', \'calendly\')',
)
@Index('UQ_calendar_connection_tenant_provider', ['tenantId', 'provider'], {
  unique: true,
})
export class CalendarConnection extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30, default: 'google' })
  provider!: StoredBookingProvider;

  @Column({ name: 'access_token_enc', type: 'text', nullable: true })
  accessTokenEncrypted!: string | null;

  @Column({ name: 'refresh_token_enc', type: 'text', nullable: true })
  refreshTokenEncrypted!: string | null;

  @Column({ name: 'access_token_expires_at', type: 'timestamptz', nullable: true })
  accessTokenExpiresAt!: Date | null;

  @Column({ name: 'refresh_token_expires_at', type: 'timestamptz', nullable: true })
  refreshTokenExpiresAt!: Date | null;

  @Column({ name: 'granted_scopes', type: 'simple-array', nullable: true })
  grantedScopes!: string[] | null;

  @Column({ name: 'provider_account_id', type: 'text', nullable: true })
  providerAccountId!: string | null;

  @Column({ name: 'provider_tenant_id', type: 'text', nullable: true })
  providerTenantId!: string | null;

  @Column({ type: 'varchar', length: 30, default: 'configured' })
  status!: CalendarConnectionStatus;

  @Column({ name: 'selected_calendar_id', type: 'text', nullable: true })
  selectedCalendarId!: string | null;

  @Column({ name: 'selected_calendar_name', type: 'varchar', length: 255, nullable: true })
  selectedCalendarName!: string | null;

  @Column({ name: 'selected_calendar_time_zone', type: 'varchar', length: 100, nullable: true })
  selectedCalendarTimeZone!: string | null;

  @Column({ name: 'selected_resource_type', type: 'varchar', length: 50, nullable: true })
  selectedResourceType!: string | null;

  @Column({ name: 'selected_resource_uri', type: 'text', nullable: true })
  selectedResourceUri!: string | null;

  @Column({ name: 'selected_resource_metadata', type: 'jsonb', nullable: true })
  selectedResourceMetadata!: Record<string, unknown> | null;

  @Column({ name: 'webhook_channel_id', type: 'varchar', length: 120, nullable: true })
  webhookChannelId!: string | null;

  @Column({ name: 'webhook_resource_id', type: 'text', nullable: true })
  webhookResourceId!: string | null;

  @Column({ name: 'webhook_token_hash', type: 'char', length: 64, nullable: true })
  webhookTokenHash!: string | null;

  @Column({ name: 'webhook_secret_enc', type: 'text', nullable: true })
  webhookSecretEncrypted!: string | null;

  @Column({ name: 'webhook_expires_at', type: 'timestamptz', nullable: true })
  webhookExpiresAt!: Date | null;

  @Column({ name: 'webhook_last_message_number', type: 'varchar', length: 40, nullable: true })
  webhookLastMessageNumber!: string | null;

  @Column({ name: 'last_tested_at', type: 'timestamptz', nullable: true })
  lastTestedAt!: Date | null;

  @Column({ name: 'last_successful_sync_at', type: 'timestamptz', nullable: true })
  lastSuccessfulSyncAt!: Date | null;

  @Column({ name: 'last_error_code', type: 'varchar', length: 100, nullable: true })
  lastErrorCode!: string | null;

  @Column({ name: 'last_error_at', type: 'timestamptz', nullable: true })
  lastErrorAt!: Date | null;

  @Column({ name: 'disconnected_at', type: 'timestamptz', nullable: true })
  disconnectedAt!: Date | null;
}
