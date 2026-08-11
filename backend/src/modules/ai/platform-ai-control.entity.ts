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

  @Column({ name: 'provider_last_tested_at', type: 'timestamptz', nullable: true })
  providerLastTestedAt?: Date | null;

  @Column({ name: 'provider_test_model', type: 'varchar', length: 120, nullable: true })
  providerTestModel?: string | null;

  @Column({ name: 'provider_test_error', type: 'text', nullable: true })
  providerTestError?: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
