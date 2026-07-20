import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from "../tenants/tenant.entity";
import { Team } from "../teams/team.entity";
import { UserRole } from "../../common/rbac";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  tenantId: string;

  @ManyToOne(() => Tenant, (t: any) => t.users, { onDelete: "CASCADE" })
  @JoinColumn({ name: "tenantId" })
  tenant: Tenant;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 255 })
  email: string;

  // Keep nullable for now so existing DB rows with null don't crash schema sync.
  @Column({ type: "varchar", length: 255, nullable: true })
  passwordHash: string | null;

  @Column({ type: "varchar", length: 50, default: "agent" })
  role: UserRole;

  @Column({ type: "uuid", nullable: true })
  teamId: string | null;

  @ManyToOne(() => Team, (team: any) => team.users, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "teamId" })
  team: Team | null;

  @Column({ type: "boolean", default: false })
  isEmailVerified: boolean;

  @Column({ type: "varchar", length: 255, nullable: true })
  emailVerifyToken: string | null;

  @Column({ type: "timestamptz", nullable: true })
  emailVerifyTokenExpiresAt: Date | null;

  @Column({ type: "boolean", default: true })
  isActive: boolean;

  @Column({ name: 'session_version', type: 'int', default: 0 })
  sessionVersion: number;

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword: boolean;

  @Column({ name: 'password_changed_at', type: 'timestamptz', nullable: true })
  passwordChangedAt: Date | null;

  @Column({ name: 'welcome_email_sent_at', type: 'timestamptz', nullable: true })
  welcomeEmailSentAt: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'platform_role', type: 'varchar', length: 30, nullable: true })
  platformRole: 'staff' | null;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updatedAt' })
  updatedAt: Date;
}
