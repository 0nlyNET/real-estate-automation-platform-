import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'audit_logs' })
@Index('IDX_audit_logs_tenant_created', ['tenantId', 'createdAt'])
export class AuditLog extends BaseEntity {
  @Column({ name: 'tenantId', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'actorId', type: 'uuid' })
  actorId!: string;

  @Column({ name: 'actorEmail', type: 'varchar', nullable: true })
  actorEmail?: string | null;

  @Column({ type: 'varchar' })
  action!: string;

  @Column({ type: 'varchar' })
  method!: string;

  @Column({ type: 'varchar' })
  path!: string;

  @Column({ name: 'statusCode', type: 'int' })
  statusCode!: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;
}
