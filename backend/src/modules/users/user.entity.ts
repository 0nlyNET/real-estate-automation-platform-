import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, Index, JoinColumn } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { Team } from '../teams/team.entity';

export type UserRole = 'owner' | 'admin' | 'agent' | 'tc' | 'read_only';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ type: 'boolean', default: false })
  isEmailVerified!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  emailVerifyToken!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerifyTokenExpiresAt!: Date | null;

  @ManyToOne(() => Tenant, (t) => t.users, { eager: true, onDelete: 'CASCADE' })
  tenant!: Tenant;

  // RBAC for Teams/Brokerages. Defaults keep existing single-user tenants working.
  @Column({ type: 'varchar', default: 'owner' })
  role!: UserRole;

  // Optional: group users inside a tenant into teams (Sales team, ISA team, etc.)
  @Column({ type: 'uuid', nullable: true })
  teamId!: string | null;

  @ManyToOne(() => Team, (team) => team.users, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'teamId' })
  team!: Team | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;
}
