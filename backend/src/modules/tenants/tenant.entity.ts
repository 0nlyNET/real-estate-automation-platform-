import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';
import { User } from '../users/user.entity';
import { Lead } from '../leads/lead.entity';
import { Credential } from '../settings/credential.entity';

@Entity({ name: 'tenants' })
export class Tenants extends BaseEntity {
  @Column({ unique: true })
  name!: string;

  @Column({ unique: true })
  slug!: string;

  @Column({ name: 'timezone', default: 'America/New_York' })
  timezone!: string;

  @Column({ name: 'quiet_hours_start', nullable: true })
  quietHoursStart?: string;

  @Column({ name: 'quiet_hours_end', nullable: true })
  quietHoursEnd?: string;
@Column({ name: 'notification_email', nullable: true })
notificationEmail?: string;

@Column({ name: 'booking_link', nullable: true })
bookingLink?: string;

  @OneToMany(() => User, (user: any) => user.tenant)
  users!: User[];

  @OneToMany(() => Lead, (lead) => lead.tenant)
  leads!: Lead[];

  @OneToMany(() => Credential, (credential) => credential.tenant)
  credentials!: Credential[];
}
