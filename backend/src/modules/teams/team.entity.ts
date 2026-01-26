import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../users/user.entity';

@Entity('teams')
@Index(['tenantId', 'name'], { unique: true })
export class Team {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @OneToMany(() => User, (u) => u.team)
  users!: User[];

  @CreateDateColumn()
  createdAt!: Date;
}
