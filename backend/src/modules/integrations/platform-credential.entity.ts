import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'platform_credentials' })
@Index('UQ_platform_credentials_provider', ['provider'], { unique: true })
export class PlatformCredential extends BaseEntity {
  @Column()
  provider!: string;

  @Column({ type: 'text' })
  encryptedValue!: string;
}
