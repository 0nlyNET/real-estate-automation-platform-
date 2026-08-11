import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'tenant_messaging_resources' })
@Index('UQ_tenant_messaging_resources_tenant', ['tenantId'], { unique: true })
@Index('UQ_tenant_messaging_resources_subaccount', ['twilioSubaccountSid'], { unique: true, where: '"twilio_subaccount_sid" IS NOT NULL' })
@Index('UQ_tenant_messaging_resources_service', ['messagingServiceSid'], { unique: true, where: '"messaging_service_sid" IS NOT NULL' })
@Index('UQ_tenant_messaging_resources_phone', ['phoneNumber'], { unique: true, where: '"phone_number" IS NOT NULL' })
export class TenantMessagingResource extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'twilio_parent_account_sid', type: 'varchar', nullable: true })
  twilioParentAccountSid!: string | null;

  @Column({ name: 'twilio_subaccount_sid', type: 'varchar', nullable: true })
  twilioSubaccountSid!: string | null;

  @Column({ name: 'twilio_api_key_sid', type: 'varchar', nullable: true })
  twilioApiKeySid!: string | null;

  @Column({ name: 'encrypted_api_secret', type: 'text', nullable: true })
  encryptedApiSecret!: string | null;

  @Column({ name: 'encrypted_auth_token', type: 'text', nullable: true })
  encryptedAuthToken!: string | null;

  @Column({ name: 'messaging_service_sid', type: 'varchar', nullable: true })
  messagingServiceSid!: string | null;

  @Column({ name: 'phone_number_sid', type: 'varchar', nullable: true })
  phoneNumberSid!: string | null;

  @Column({ name: 'phone_number', type: 'varchar', nullable: true })
  phoneNumber!: string | null;

  @Column({ name: 'a2p_customer_profile_sid', type: 'varchar', nullable: true })
  a2pCustomerProfileSid!: string | null;

  @Column({ name: 'a2p_trust_product_sid', type: 'varchar', nullable: true })
  a2pTrustProductSid!: string | null;

  @Column({ name: 'a2p_brand_sid', type: 'varchar', nullable: true })
  a2pBrandSid!: string | null;

  @Column({ name: 'a2p_campaign_sid', type: 'varchar', nullable: true })
  a2pCampaignSid!: string | null;

  @Column({ name: 'a2p_compliance_status', default: 'not_started' })
  a2pComplianceStatus!: string;

  @Column({ name: 'a2p_provider_status', type: 'varchar', nullable: true })
  a2pProviderStatus!: string | null;

  @Column({ name: 'a2p_input_hash', type: 'varchar', length: 64, nullable: true })
  a2pInputHash!: string | null;

  @Column({ name: 'a2p_rejection_reason', type: 'text', nullable: true })
  a2pRejectionReason!: string | null;

  @Column({ name: 'a2p_last_checked_at', type: 'timestamptz', nullable: true })
  a2pLastCheckedAt!: Date | null;

  @Column({ name: 'a2p_next_poll_at', type: 'timestamptz', nullable: true })
  a2pNextPollAt!: Date | null;

  @Column({ name: 'sms_status', default: 'pending' })
  smsStatus!: 'pending' | 'provisioning' | 'testing' | 'ready' | 'blocked' | 'failed';

  @Column({ name: 'sms_last_verified_at', type: 'timestamptz', nullable: true })
  smsLastVerifiedAt!: Date | null;

  @Column({ name: 'provisioning_step', default: 'not_started' })
  provisioningStep!: string;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'lease_owner', type: 'varchar', nullable: true })
  leaseOwner!: string | null;

  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;
}
