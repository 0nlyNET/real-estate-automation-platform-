import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('email_opt_outs')
@Index(['tenantId', 'emailLower'], { unique: true })
export class EmailOptOut {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 256 })
  emailLower: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  source: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
