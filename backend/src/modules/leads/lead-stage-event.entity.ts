import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'lead_stage_events' })
@Index(['tenantId', 'createdAt'])
@Index(['leadId', 'createdAt'])
export class LeadStageEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'lead_id', type: 'uuid' })
  leadId!: string;

  @Column({ name: 'previous_stage', type: 'varchar', nullable: true })
  previousStage?: string | null;

  @Column({ name: 'new_stage', type: 'varchar' })
  newStage!: string;

  @Column({ name: 'changed_by_user_id', type: 'uuid', nullable: true })
  changedByUserId?: string | null;

  @Column({ name: 'change_source', type: 'varchar', default: 'application' })
  changeSource!: string;

  @Column({ type: 'text', nullable: true })
  note?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
