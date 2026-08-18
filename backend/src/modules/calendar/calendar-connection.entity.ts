import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

export type CalendarConnectionStatus =
  | 'configured'
  | 'connected'
  | 'needs_attention'
  | 'disconnected';

@Entity({ name: 'calendar_connections' })
@Index('UQ_calendar_connection_tenant_provider', ['tenantId', 'provider'], {
  unique: true,
})
export class CalendarConnection extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30, default: 'google' })
  provider!: 'google';

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

  @Column({ type: 'varchar', length: 30, default: 'configured' })
  status!: CalendarConnectionStatus;

  @Column({ name: 'selected_calendar_id', type: 'text', nullable: true })
  selectedCalendarId!: string | null;

  @Column({ name: 'selected_calendar_name', type: 'varchar', length: 255, nullable: true })
  selectedCalendarName!: string | null;

  @Column({ name: 'selected_calendar_time_zone', type: 'varchar', length: 100, nullable: true })
  selectedCalendarTimeZone!: string | null;

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
