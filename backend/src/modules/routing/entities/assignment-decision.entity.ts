import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AssignmentDecision = 'assigned' | 'skipped_no_match' | 'skipped_no_available' | 'fallback_assigned' | 'failed';

@Entity('assignment_decisions')
@Index(['tenantId', 'createdAt'])
@Index(['tenantId', 'leadId'])
export class AssignmentDecisionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid', nullable: true })
  leadId: string | null;

  @Column({ type: 'uuid', nullable: true })
  ruleId: string | null;

  @Column({ type: 'uuid', nullable: true })
  assignedUserId: string | null;

  @Column({ type: 'uuid', nullable: true })
  assignedTeamId: string | null;

  @Column({ type: 'varchar', length: 32 })
  decision: AssignmentDecision;

  @Column({ type: 'varchar', length: 512, nullable: true })
  reason: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
