import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { OnboardingRecord } from '../onboarding/onboarding-record.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { OperationsTask } from '../operations/operations-task.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Tenant } from '../tenants/tenant.entity';
import { ServiceControlService } from './service-control.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      TenantSettings,
      OnboardingRecord,
      OperationsTask,
    ]),
    AuditModule,
    NotificationsModule,
  ],
  providers: [ServiceControlService],
  exports: [ServiceControlService],
})
export class ServiceControlModule {}
