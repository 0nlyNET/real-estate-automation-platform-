import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

export type Plan = 'trial' | 'pro' | 'teams';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 200, default: 'My Workspace' })
  name!: string;

  @Column({ type: 'varchar', length: 32, default: 'trial' })
  plan!: Plan;

  @Column({ type: 'varchar', length: 32, default: 'trialing' })
  status!: string;

  @Column({ type: 'timestamptz', nullable: true })
  trialEndsAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodEnd!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  stripeCustomerId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  stripeSubscriptionId!: string | null;

  @OneToMany(() => User, (u) => u.tenant)
  users!: User[];
}
