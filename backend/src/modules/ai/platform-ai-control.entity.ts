import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'platform_ai_controls' })
export class PlatformAiControl {
  @PrimaryColumn({ type: 'varchar', length: 40, default: 'global' })
  id!: string;

  @Column({ type: 'boolean', default: false })
  paused!: boolean;

  @Column({ type: 'text', nullable: true })
  reason?: string | null;

  @Column({ name: 'updated_by_id', type: 'uuid', nullable: true })
  updatedById?: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
