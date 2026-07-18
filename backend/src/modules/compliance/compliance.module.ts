import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComplianceOptOut } from './compliance-optout.entity';
import { ComplianceEvent } from './compliance-event.entity';
import { TenantQuietHours } from './tenant-quiet-hours.entity';
import { ComplianceService } from './compliance.service';
import { ComplianceController } from './compliance.controller';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ComplianceOptOut, ComplianceEvent, TenantQuietHours, TenantSettings]),
    CommonModule,
  ],
  providers: [ComplianceService],
  controllers: [ComplianceController],
  exports: [ComplianceService],
})
export class ComplianceModule {}
