import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'audit_logs' })
export class AuditLog extends BaseEntity {
  @Column()
  actorId!: string;

  @Column()
  action!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;
}
