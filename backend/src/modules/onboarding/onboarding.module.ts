import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OnboardingRecord } from './onboarding-record.entity';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { Tenant } from '../tenants/tenant.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Credential } from '../settings/credential.entity';
import { SequenceStep } from '../sequences/sequence-step.entity';
import { OperationsModule } from '../operations/operations.module';
import { CommonModule } from '../../common/common.module';
import { LimitsModule } from '../limits/limits.module';
import { AuditModule } from '../audit/audit.module';
import { TenantMessagingResource } from '../integrations/tenant-messaging-resource.entity';
import { TenantEmailIdentity } from '../integrations/tenant-email-identity.entity';
import { TestRun } from '../testing/test-run.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OnboardingRecord,
      Tenant,
      TenantSettings,
      Credential,
      SequenceStep,
      TenantMessagingResource,
      TenantEmailIdentity,
      TestRun,
    ]),
    OperationsModule,
    CommonModule,
    LimitsModule,
    AuditModule,
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
