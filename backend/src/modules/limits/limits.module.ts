import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperationsModule } from '../operations/operations.module';
import { LimitsService } from './limits.service';
import { UsageBucket } from './usage-bucket.entity';
import { UsagePolicy } from './usage-policy.entity';
import { UsageReservation } from './usage-reservation.entity';
import { ServiceControlModule } from '../service-control/service-control.module';
import { TenantQualityMonitorService } from './tenant-quality-monitor.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      UsagePolicy,
      UsageBucket,
      UsageReservation,
    ]),
    AuditModule,
    NotificationsModule,
    OperationsModule,
    ServiceControlModule,
  ],
  providers: [LimitsService, TenantQualityMonitorService],
  exports: [LimitsService, TenantQualityMonitorService],
})
export class LimitsModule {}
