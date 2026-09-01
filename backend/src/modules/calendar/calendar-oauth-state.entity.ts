import { Check, Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'calendar_oauth_states' })
@Check(
  'CK_calendar_oauth_state_provider',
  '"provider" IN (\'google\', \'microsoft\', \'calendly\', \'facebook\')',
)
export class CalendarOAuthState extends BaseEntity {
  @Index('UQ_calendar_oauth_state_hash', { unique: true })
  @Column({ name: 'state_hash', type: 'char', length: 64 })
  stateHash!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 30, default: 'google' })
  provider!: 'google' | 'microsoft' | 'calendly' | 'facebook';

  @Column({ name: 'code_verifier_enc', type: 'text' })
  codeVerifierEncrypted!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
}
