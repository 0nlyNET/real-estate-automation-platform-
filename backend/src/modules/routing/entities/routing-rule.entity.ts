import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type RoutingActionType = 'round_robin_team' | 'fixed_user';
export type RoutingMatchType = 'source' | 'location' | 'lead_type' | 'stage';

@Entity('routing_rules')
@Index(['tenantId', 'isActive'])
export class RoutingRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  tenantId: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 100 })
  priority: number;

  @Column({ type: 'varchar', length: 32 })
  matchType: RoutingMatchType;

  @Column({ type: 'varchar', length: 128, nullable: true })
  matchValue: string | null;

  @Column({ type: 'varchar', length: 32 })
  actionType: RoutingActionType;

  @Column({ type: 'uuid', nullable: true })
  actionTeamId: string | null;

  @Column({ type: 'uuid', nullable: true })
  actionUserId: string | null;

  @Column({ type: 'uuid', nullable: true })
  fallbackTeamId: string | null;

  @Column({ type: 'uuid', nullable: true })
  fallbackUserId: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  name: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
