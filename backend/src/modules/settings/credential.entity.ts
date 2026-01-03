import { Column, Entity, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Tenants } from '../tenants/tenant.entity';

@Entity({ name: 'credentials' })
export class Credential extends BaseEntity {
  @ManyToOne(() => Tenants, (tenant) => tenant.credentials)
  tenant!: Tenants;

  @Column()
  provider!: string;

  @Column({ type: 'text' })
  encryptedValue!: string;
}
