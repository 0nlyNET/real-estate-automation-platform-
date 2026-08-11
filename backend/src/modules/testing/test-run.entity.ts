import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'test_runs' })
@Index('IDX_test_runs_tenant_status', ['tenantId', 'status'])
export class TestRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'started_by_id', type: 'uuid', nullable: true })
  startedById!: string | null;

  @Column({ default: 'running' })
  status!: 'running' | 'passed' | 'failed' | 'expired';

  @Column({ name: 'sms_recipient', type: 'varchar', nullable: true })
  smsRecipient!: string | null;

  @Column({ name: 'email_recipient', type: 'varchar', nullable: true })
  emailRecipient!: string | null;

  @Column({ name: 'test_lead_id', type: 'uuid', nullable: true })
  testLeadId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  checks!: Record<string, unknown>;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
