import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'tenant_settings' })
export class TenantSettings extends BaseEntity {
  @Index({ unique: true })
  @Column({ name: 'tenant_id', type: 'varchar' })
  tenantId!: string;

  @Column({ name: 'time_zone', type: 'varchar', default: 'America/New_York' })
  timeZone!: string;

  @Column({ name: 'quiet_hours_start', type: 'varchar', default: '21:00' })
  quietHoursStart!: string;

  @Column({ name: 'quiet_hours_end', type: 'varchar', default: '08:00' })
  quietHoursEnd!: string;

  @Column({ name: 'booking_link', type: 'varchar', nullable: true })
  bookingLink?: string;

  @Column({ name: 'automations_enabled', type: 'bool', default: true })
  automationsEnabled!: boolean;
  // -------- Integrations foundation (Phase 1) --------
  @Column({ name: 'zapier_api_key_hash', type: 'varchar', nullable: true })
  zapierApiKeyHash?: string;

  @Column({ name: 'zapier_api_key_last4', type: 'varchar', nullable: true })
  zapierApiKeyLast4?: string;

  @Column({ name: 'webhook_url', type: 'varchar', nullable: true })
  webhookUrl?: string;

  @Column({ name: 'webhook_events', type: 'simple-array', nullable: true })
  webhookEvents?: string[];

  @Column({ name: 'facebook_connected', type: 'bool', default: false })
  facebookConnected!: boolean;

  @Column({ name: 'facebook_page_name', type: 'varchar', nullable: true })
  facebookPageName?: string;

  @Column({ name: 'facebook_form_id', type: 'varchar', nullable: true })
  facebookFormId?: string;

}
