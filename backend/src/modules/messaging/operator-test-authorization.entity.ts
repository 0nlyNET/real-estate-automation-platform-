import { Column, Entity, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * Server-created authorization for operator messaging tests.
 * 
 * This is NOT a billing bypass. It is a distinct, audited authorization that
 * allows a specific tenant to send test emails to allowlisted recipients
 * WITHOUT representing the tenant as a paid client.
 * 
 * Key invariants:
 * - Created ONLY by server-side code (admin API), never by client input.
 * - Bound to exact tenant ID, recipient allowlist, email channel, and expiry.
 * - The tenant's billing status remains unchanged (billingEligible=false).
 * - All sends are flagged isOperatorTest=true and audited.
 * - Expiration or revocation immediately blocks new and queued sends.
 */
@Entity('operator_test_authorizations')
@Index(['tenantId', 'isRevoked'])
export class OperatorTestAuthorization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'recipient_allowlist', type: 'text', array: true })
  recipientAllowlist: string[];

  @Column({ name: 'channel', type: 'varchar', length: 20, default: 'email' })
  channel: string; // 'email' only for now

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'daily_limit', type: 'int', default: 10 })
  dailyLimit: number;

  @Column({ name: 'total_limit', type: 'int', default: 50 })
  totalLimit: number;

  @Column({ name: 'is_revoked', type: 'boolean', default: false })
  isRevoked: boolean;

  @Column({ name: 'created_by', type: 'varchar', length: 255 })
  createdBy: string; // admin user ID who created it

  @Column({ name: 'purpose', type: 'text', nullable: true })
  purpose: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
