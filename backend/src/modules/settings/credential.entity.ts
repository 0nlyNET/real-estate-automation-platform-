import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { Tenant } from '../tenants/tenant.entity';

@Entity({ name: 'credentials' })
@Index('IDX_credentials_provider_routing_key', ['provider', 'routingKey'], {
  unique: true,
  where: '"routingKey" IS NOT NULL',
})
export class Credential extends BaseEntity {
  @ManyToOne(() => Tenant, (tenant) => tenant.credentials)
  tenant!: Tenant;

  @Column()
  provider!: string;

  @Column({ name: 'routingKey', type: 'varchar', nullable: true })
  routingKey?: string | null;

  @Column({
    name: 'ingestion_key_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  @Index('IDX_credentials_provider_ingestion_key_hash', {
    unique: true,
    where: '"ingestion_key_hash" IS NOT NULL',
  })
  ingestionKeyHash?: string | null;

  @Column({ type: 'text' })
  encryptedValue!: string;
}
