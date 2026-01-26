import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('sms_opt_outs')
@Index(['tenantId', 'phoneE164'], { unique: true })
export class SmsOptOut {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 32 })
  phoneE164: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  source: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
