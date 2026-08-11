import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'tenant_email_identities' })
@Index('UQ_tenant_email_identities_tenant', ['tenantId'], { unique: true })
@Index('UQ_tenant_email_identities_reply_token', ['replyToken'], { unique: true })
@Index('UQ_tenant_email_identities_inbound', ['inboundAddress'], { unique: true })
@Index('UQ_tenant_email_identities_from_email', ['fromEmail'], { unique: true })
export class TenantEmailIdentity extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'from_email' })
  fromEmail!: string;

  @Column({ name: 'from_name' })
  fromName!: string;

  @Column({ name: 'reply_token' })
  replyToken!: string;

  @Column({ name: 'inbound_address' })
  inboundAddress!: string;

  @Column({ type: 'text', nullable: true })
  signature!: string | null;

  @Column({ name: 'classification', default: 'lead_follow_up' })
  classification!: 'transactional' | 'lead_follow_up';

  @Column({ name: 'reputation_status', default: 'warming' })
  reputationStatus!: 'warming' | 'healthy' | 'paused' | 'blocked';

  @Column({ name: 'email_status', default: 'pending' })
  emailStatus!: 'pending' | 'testing' | 'ready' | 'blocked' | 'failed';

  @Column({ name: 'last_verified_at', type: 'timestamptz', nullable: true })
  lastVerifiedAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'custom_domain', type: 'varchar', nullable: true })
  customDomain!: string | null;

  @Column({ name: 'sendgrid_subuser_id', type: 'varchar', nullable: true })
  sendgridSubuserId!: string | null;

  @Column({ name: 'domain_verification_status', default: 'platform_authenticated' })
  domainVerificationStatus!:
    | 'platform_authenticated'
    | 'pending'
    | 'verified'
    | 'failed';
}
