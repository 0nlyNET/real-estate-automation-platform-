import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PresenceStatus = 'online' | 'offline';

@Entity('agent_presence')
@Index(['tenantId', 'teamId'])
@Index(['tenantId', 'userId'], { unique: true })
export class AgentPresence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'uuid', nullable: true })
  teamId: string | null;

  @Column({ type: 'varchar', length: 16, default: 'offline' })
  status: PresenceStatus;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
