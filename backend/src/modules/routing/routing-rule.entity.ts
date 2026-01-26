import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('routing_rules')
@Index(['tenantId', 'isActive'])
@Index(['tenantId', 'priority'])
export class RoutingRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  // Lower number = evaluated earlier
  @Column({ type: 'int', default: 100 })
  priority: number;

  @Column({ type: 'jsonb', default: {} })
  conditions: any;

  @Column({ type: 'text' })
  actionType: string;

  @Column({ type: 'jsonb', default: {} })
  actionConfig: any;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
