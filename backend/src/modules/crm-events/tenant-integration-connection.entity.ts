import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'tenant_integration_connections' })
@Index('UQ_tenant_integration_connection_public_id', ['publicIdentifier'], { unique: true })
@Index('IDX_tenant_integration_connection_tenant_provider', ['tenantId', 'provider'])
export class TenantIntegrationConnection extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: 'zapier';

  @Column({ type: 'varchar', length: 30, default: 'active' })
  status!: 'active' | 'revoked' | 'error';

  @Column({ name: 'public_identifier', type: 'varchar', length: 32 })
  publicIdentifier!: string;

  @Column({ name: 'secret_hash', type: 'varchar', length: 64 })
  secretHash!: string;

  @Column({ name: 'secret_last4', type: 'varchar', length: 4 })
  secretLast4!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  configuration!: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  capabilities!: Record<string, boolean>;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: 'last_tested_at', type: 'timestamptz', nullable: true })
  lastTestedAt!: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
