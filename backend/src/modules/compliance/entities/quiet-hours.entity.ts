import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('quiet_hours_settings')
@Index(['tenantId'], { unique: true })
export class QuietHoursSetting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  tenantId: string;

  @Column({ type: 'varchar', length: 64, default: 'America/New_York' })
  timezone: string;

  @Column({ type: 'int', default: 21 })
  startHourLocal: number;

  @Column({ type: 'int', default: 8 })
  endHourLocal: number;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
