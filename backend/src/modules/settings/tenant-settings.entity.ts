import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/base.entity';

@Entity({ name: 'tenant_settings' })
export class TenantSettings extends BaseEntity {
  @Index({ unique: true })
  @Column({ name: 'tenant_id', type: 'varchar' })
  tenantId!: string;

  @Column({ name: 'time_zone', type: 'varchar', default: 'America/New_York' })
  timeZone!: string;

  @Column({ name: 'quiet_hours_start', type: 'varchar', default: '21:00' })
  quietHoursStart!: string;

  @Column({ name: 'quiet_hours_end', type: 'varchar', default: '08:00' })
  quietHoursEnd!: string;

  @Column({ name: 'booking_link', type: 'varchar', nullable: true })
  bookingLink?: string;

  @Column({ name: 'automations_enabled', type: 'bool', default: true })
  automationsEnabled!: boolean;
}
