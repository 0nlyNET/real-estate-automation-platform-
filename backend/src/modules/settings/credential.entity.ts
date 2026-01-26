import { Column, Entity, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Tenant } from '../tenants/tenant.entity';

@Entity({ name: 'credentials' })
export class Credential extends BaseEntity {
  @ManyToOne(() => Tenant, (tenant) => tenant.credentials)
  tenant!: Tenant;

  @Column()
  provider!: string;

  @Column({ type: 'text' })
  encryptedValue!: string;
}
