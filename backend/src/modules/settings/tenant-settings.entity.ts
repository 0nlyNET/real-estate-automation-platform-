import { Check, Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../common/base.entity";
import { BookingProviderName } from '../calendar/booking-provider.types';

@Entity({ name: "tenant_settings" })
@Check(
  'CK_tenant_settings_active_booking_provider',
  '"active_booking_provider" IS NULL OR "active_booking_provider" IN (\'google_calendar\', \'microsoft_calendar\', \'calendly\')',
)
export class TenantSettings extends BaseEntity {
  @Index({ unique: true })
  @Column({ name: "tenant_id", type: "varchar" })
  tenantId!: string;

  @Column({ name: "time_zone", type: "varchar", default: "America/New_York" })
  timeZone!: string;

  @Column({ name: "quiet_hours_start", type: "varchar", default: "21:00" })
  quietHoursStart!: string;

  @Column({ name: "quiet_hours_end", type: "varchar", default: "08:00" })
  quietHoursEnd!: string;

  @Column({ name: "booking_link", type: "varchar", nullable: true })
  bookingLink?: string;

  @Column({ name: 'booking_link_verified_at', type: 'timestamptz', nullable: true })
  bookingLinkVerifiedAt?: Date | null;

  @Column({
    name: "booking_link_verification_status",
    type: "varchar",
    length: 30,
    default: "unverified",
  })
  bookingLinkVerificationStatus!:
    | "unverified"
    | "verified"
    | "failed"
    | "revoked";

  @Column({
    name: "booking_link_verification_expires_at",
    type: "timestamptz",
    nullable: true,
  })
  bookingLinkVerificationExpiresAt?: Date | null;

  @Column({
    name: "booking_link_revoked_at",
    type: "timestamptz",
    nullable: true,
  })
  bookingLinkRevokedAt?: Date | null;

  @Column({
    name: 'active_booking_provider',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  activeBookingProvider?: BookingProviderName | null;

  @Column({
    name: "time_zone_verified_at",
    type: "timestamptz",
    nullable: true,
  })
  timeZoneVerifiedAt?: Date | null;

  @Column({ name: "automations_enabled", type: "bool", default: false })
  automationsEnabled!: boolean;

  // -------- Teams/Brokerages (routing) --------
  @Column({ name: "round_robin_enabled", type: "bool", default: false })
  roundRobinEnabled!: boolean;

  @Column({ name: "round_robin_team_id", type: "varchar", nullable: true })
  roundRobinTeamId?: string | null;

  @Column({ name: "round_robin_last_user_id", type: "varchar", nullable: true })
  roundRobinLastUserId?: string | null;
  // -------- Integrations foundation (Phase 1) --------
  @Column({ name: "zapier_api_key_hash", type: "varchar", nullable: true })
  zapierApiKeyHash?: string;

  @Column({ name: "zapier_api_key_last4", type: "varchar", nullable: true })
  zapierApiKeyLast4?: string;

  @Index("IDX_tenant_settings_intake_key_hash", {
    unique: true,
    where: '"intake_api_key_hash" IS NOT NULL',
  })
  @Column({ name: "intake_api_key_hash", type: "varchar", nullable: true })
  intakeApiKeyHash?: string | null;

  @Column({ name: "intake_api_key_last4", type: "varchar", nullable: true })
  intakeApiKeyLast4?: string | null;

  @Column({
    name: "intake_api_key_rotated_at",
    type: "timestamptz",
    nullable: true,
  })
  intakeApiKeyRotatedAt?: Date | null;

  @Column({ name: 'intake_last_received_at', type: 'timestamptz', nullable: true })
  intakeLastReceivedAt?: Date | null;

  @Column({ name: "webhook_url", type: "varchar", nullable: true })
  webhookUrl?: string;

  @Column({ name: "webhook_events", type: "simple-array", nullable: true })
  webhookEvents?: string[];

  @Column({ name: "facebook_connected", type: "bool", default: false })
  facebookConnected!: boolean;

  @Column({ name: "facebook_page_name", type: "varchar", nullable: true })
  facebookPageName?: string;

  @Column({ name: "facebook_form_id", type: "varchar", nullable: true })
  facebookFormId?: string;

  // -------- Messaging providers (Bring Your Own) --------
  @Column({ name: "twilio_account_sid", type: "varchar", nullable: true })
  twilioAccountSid?: string;

  @Column({ name: "twilio_auth_token_enc", type: "varchar", nullable: true })
  twilioAuthTokenEnc?: string;

  @Column({ name: "twilio_from_number", type: "varchar", nullable: true })
  twilioFromNumber?: string;

  @Column({
    name: "twilio_messaging_service_sid",
    type: "varchar",
    nullable: true,
  })
  twilioMessagingServiceSid?: string;

  @Column({ name: "sendgrid_api_key_enc", type: "varchar", nullable: true })
  sendgridApiKeyEnc?: string;

  @Column({ name: "sendgrid_from_email", type: "varchar", nullable: true })
  sendgridFromEmail?: string;

  @Column({ name: "sendgrid_from_name", type: "varchar", nullable: true })
  sendgridFromName?: string;

  // Lead source selection (MVP)
  @Column({ name: "lead_source", type: "varchar", nullable: true })
  leadSource?:
    | "zapier_webhook"
    | "facebook_lead_ads"
    | "website_form"
    | "other";

  @Column({ name: "lead_source_other_label", type: "varchar", nullable: true })
  leadSourceOtherLabel?: string;
}
