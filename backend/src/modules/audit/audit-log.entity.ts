import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'audit_logs' })
@Index('IDX_audit_logs_tenant_created', ['tenantId', 'createdAt'])
export class AuditLog extends BaseEntity {
  @Column({ name: 'tenantId', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'actorId', type: 'uuid' })
  actorId!: string;

  @Column({ name: 'actor_type', type: 'varchar', length: 30, default: 'user' })
  actorType!: 'user' | 'platform_operator' | 'system' | 'provider';

  @Column({ name: 'actorEmail', type: 'varchar', nullable: true })
  actorEmail?: string | null;

  @Column({ type: 'varchar' })
  action!: string;

  @Column({
    name: 'event_type',
    type: 'varchar',
    length: 160,
    default: 'legacy.event',
  })
  eventType!: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 100, nullable: true })
  resourceType?: string | null;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId?: string | null;

  @Column({ name: 'before_state', type: 'jsonb', nullable: true })
  beforeState?: Record<string, unknown> | null;

  @Column({ name: 'after_state', type: 'jsonb', nullable: true })
  afterState?: Record<string, unknown> | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress?: string | null;

  @Column({ type: 'varchar' })
  method!: string;

  @Column({ type: 'varchar' })
  path!: string;

  @Column({ name: 'statusCode', type: 'int' })
  statusCode!: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;
}
