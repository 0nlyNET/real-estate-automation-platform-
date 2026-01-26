import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('routing_assignment_logs')
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'leadId'])
export class RoutingAssignmentLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid', nullable: true })
  ruleId: string | null;

  @Column({ type: 'uuid' })
  leadId: string;

  @Column({ type: 'uuid', nullable: true })
  assignedToUserId: string | null;

  @Column({ type: 'uuid', nullable: true })
  assignedToTeamId: string | null;

  @Column({ type: 'text' })
  decision: string;

  @Column({ type: 'jsonb', nullable: true })
  meta: any | null;

  @CreateDateColumn()
  createdAt: Date;
}
