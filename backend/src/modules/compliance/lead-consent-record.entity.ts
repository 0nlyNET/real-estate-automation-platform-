import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'lead_consent_records' })
@Index(['leadId', 'channel'], { unique: true })
@Index(['tenantId', 'status'])
export class LeadConsentRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  @Column({ type: 'varchar', length: 20 })
  channel!: 'sms' | 'email';

  @Column({ type: 'varchar', length: 30, default: 'unknown' })
  status!: 'unknown' | 'affirmative' | 'revoked';

  @Column({ type: 'varchar', length: 255, nullable: true })
  source?: string | null;

  @Column({ name: 'disclosure_text', type: 'text', nullable: true })
  disclosureText?: string | null;

  @Column({ name: 'disclosure_version', type: 'varchar', length: 100, nullable: true })
  disclosureVersion?: string | null;

  @Column({ name: 'consented_at', type: 'timestamptz', nullable: true })
  consentedAt?: Date | null;

  @Column({ name: 'capture_url', type: 'varchar', length: 1000, nullable: true })
  captureUrl?: string | null;

  @Column({ name: 'source_identifier', type: 'varchar', length: 255, nullable: true })
  sourceIdentifier?: string | null;

  @Column({ name: 'capture_ip', type: 'varchar', length: 64, nullable: true })
  captureIp?: string | null;

  @Column({ name: 'imported_by_user_id', type: 'uuid', nullable: true })
  importedByUserId?: string | null;

  @Column({ name: 'client_attested', type: 'boolean', default: false })
  clientAttested!: boolean;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @Column({ name: 'revocation_source', type: 'varchar', length: 255, nullable: true })
  revocationSource?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
