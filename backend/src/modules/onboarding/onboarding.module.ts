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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OnboardingRecord,
      Tenant,
      TenantSettings,
      Credential,
      SequenceStep,
    ]),
    OperationsModule,
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
