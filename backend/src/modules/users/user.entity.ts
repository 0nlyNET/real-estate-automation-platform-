import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, Index } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';

export type UserRole = 'USER' | 'AGENCY_ADMIN';

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

  @Column({ type: 'varchar', length: 32, default: 'USER' })
  role!: UserRole;

  @ManyToOne(() => Tenant, (t) => t.users, { eager: true, onDelete: 'CASCADE' })
  tenant!: Tenant;
}
