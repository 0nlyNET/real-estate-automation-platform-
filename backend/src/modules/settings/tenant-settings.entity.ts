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

  // -------- Teams/Brokerages (routing) --------
  @Column({ name: 'round_robin_enabled', type: 'bool', default: false })
  roundRobinEnabled!: boolean;

  @Column({ name: 'round_robin_team_id', type: 'varchar', nullable: true })
  roundRobinTeamId?: string | null;

  @Column({ name: 'round_robin_last_user_id', type: 'varchar', nullable: true })
  roundRobinLastUserId?: string | null;
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

  // -------- Messaging providers (Bring Your Own) --------
  @Column({ name: 'twilio_account_sid', type: 'varchar', nullable: true })
  twilioAccountSid?: string;

  @Column({ name: 'twilio_auth_token_enc', type: 'varchar', nullable: true })
  twilioAuthTokenEnc?: string;

  @Column({ name: 'twilio_from_number', type: 'varchar', nullable: true })
  twilioFromNumber?: string;

  @Column({ name: 'twilio_messaging_service_sid', type: 'varchar', nullable: true })
  twilioMessagingServiceSid?: string;

  @Column({ name: 'sendgrid_api_key_enc', type: 'varchar', nullable: true })
  sendgridApiKeyEnc?: string;

  @Column({ name: 'sendgrid_from_email', type: 'varchar', nullable: true })
  sendgridFromEmail?: string;

  @Column({ name: 'sendgrid_from_name', type: 'varchar', nullable: true })
  sendgridFromName?: string;

  // Lead source selection (MVP)
  @Column({ name: 'lead_source', type: 'varchar', nullable: true })
  leadSource?: 'zapier_webhook' | 'facebook_lead_ads' | 'website_form' | 'other';

  @Column({ name: 'lead_source_other_label', type: 'varchar', nullable: true })
  leadSourceOtherLabel?: string;

}
