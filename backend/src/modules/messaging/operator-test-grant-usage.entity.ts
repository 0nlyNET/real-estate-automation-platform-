import { Column, Entity, PrimaryGeneratedColumn, CreateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { OperatorTestAuthorization } from './operator-test-authorization.entity';

/**
 * Transactional quota reservation for operator test sends.
 * 
 * Each reservation is keyed to (grant_id, message_id):
 * - Retries reuse the SAME reservation (idempotent).
 * - Concurrent workers cannot double-reserve (UNIQUE constraint).
 * - Quota checks are transactional, not count-then-insert.
 */
@Entity('operator_test_grant_usages')
@Index(['grantId', 'reservedAt'])
@Index(['tenantId', 'reservedAt'])
export class OperatorTestGrantUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'grant_id', type: 'uuid' })
  grantId: string;

  @ManyToOne(() => OperatorTestAuthorization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grant_id' })
  grant: OperatorTestAuthorization;

  @Column({ name: 'message_id', type: 'uuid', unique: true })
  messageId: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId: string;

  @Column({ name: 'recipient_email', type: 'varchar', length: 255 })
  recipientEmail: string;

  @CreateDateColumn({ name: 'reserved_at' })
  reservedAt: Date;
}
