import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AiApprovalStatus } from './workspace-ai-settings.entity';

export type ApprovedFaq = { question: string; answer: string };
export type ApprovedAgent = {
  id?: string;
  name: string;
  title?: string;
  serviceAreas?: string[];
};

@Entity({ name: 'brokerage_ai_knowledge' })
@Index(['tenantId'], { unique: true })
export class BrokerageKnowledge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'public_name', type: 'varchar', length: 160, nullable: true })
  publicName?: string | null;

  @Column({ name: 'office_email', type: 'varchar', length: 255, nullable: true })
  officeEmail?: string | null;

  @Column({ name: 'office_phone', type: 'varchar', length: 40, nullable: true })
  officePhone?: string | null;

  @Column({ name: 'service_areas', type: 'simple-array', nullable: true })
  serviceAreas?: string[] | null;

  @Column({ name: 'business_hours', type: 'jsonb', default: () => "'{}'::jsonb" })
  businessHours!: Record<string, string>;

  @Column({ name: 'scheduling_instructions', type: 'text', nullable: true })
  schedulingInstructions?: string | null;

  @Column({ name: 'approved_faqs', type: 'jsonb', default: () => "'[]'::jsonb" })
  approvedFaqs!: ApprovedFaq[];

  @Column({ name: 'escalation_instructions', type: 'text', nullable: true })
  escalationInstructions?: string | null;

  @Column({ name: 'qualification_questions', type: 'simple-array', nullable: true })
  qualificationQuestions?: string[] | null;

  @Column({ name: 'prohibited_topics', type: 'simple-array', nullable: true })
  prohibitedTopics?: string[] | null;

  @Column({ name: 'agent_roster', type: 'jsonb', default: () => "'[]'::jsonb" })
  agentRoster!: ApprovedAgent[];

  @Column({ name: 'routing_rules', type: 'jsonb', default: () => "'{}'::jsonb" })
  routingRules!: Record<string, unknown>;

  @Column({ name: 'required_disclaimer', type: 'text', nullable: true })
  requiredDisclaimer?: string | null;

  @Column({ name: 'approval_status', type: 'varchar', length: 20, default: 'draft' })
  approvalStatus!: AiApprovalStatus;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt?: Date | null;

  @Column({ name: 'approved_by_id', type: 'uuid', nullable: true })
  approvedById?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
