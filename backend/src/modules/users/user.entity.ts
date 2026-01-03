import { BaseEntity } from '../../common/base.entity';
import { Column, Entity, Index } from 'typeorm';

@Entity('users')
export class User extends BaseEntity {
  @Index({ unique: true })
  @Column({ name: 'email' })
  email!: string;

  @Column({ name: 'password_hash' })
  passwordHash!: string;

  @Column({ name: 'role', default: 'admin' })
  role!: 'admin' | 'agent';

  @Column({ name: 'tenant_id', nullable: true })
  tenantId?: string;
}

