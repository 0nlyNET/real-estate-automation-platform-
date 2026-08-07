import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Credential } from './credential.entity';
import { TenantSettings } from './tenant-settings.entity';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { Team } from '../teams/team.entity';
import { TenantQuietHours } from '../compliance/tenant-quiet-hours.entity';
import { CommonModule } from '../../common/common.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [TypeOrmModule.forFeature([Credential, TenantSettings, Team, TenantQuietHours]), CommonModule, OnboardingModule],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [TypeOrmModule, SettingsService],
})
export class SettingsModule {}
