import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'agency_applications' })
@Index('idx_agency_applications_email', ['email'])
@Index('idx_agency_applications_created_at', ['createdAt'])
export class AgencyApplication extends BaseEntity {
  @Column({ name: 'full_name', type: 'text' })
  fullName!: string;

  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'text', nullable: true })
  phone?: string;

  @Column({ type: 'text', nullable: true })
  company?: string;

  @Column({ name: 'team_size', type: 'text', nullable: true })
  teamSize?: string;

  @Column({ name: 'lead_sources', type: 'text', nullable: true })
  leadSources?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ name: 'source_page', type: 'text', nullable: true })
  sourcePage?: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent?: string;

  @Column({ type: 'varchar', default: 'new' })
  status!: string;
}
