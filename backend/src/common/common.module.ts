import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './guards/roles.guard';
import { TeamsPlanGuard } from './guards/plan.guard';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../modules/tenants/tenant.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant])],
  providers: [Reflector, RolesGuard, TeamsPlanGuard, PlatformAdminGuard],
  exports: [TypeOrmModule, RolesGuard, TeamsPlanGuard, PlatformAdminGuard],
})
export class CommonModule {}
