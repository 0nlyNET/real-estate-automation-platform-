import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './guards/roles.guard';
import { TeamsPlanGuard } from './guards/plan.guard';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { PlatformOperatorGuard } from './guards/platform-operator.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../modules/tenants/tenant.entity';
import { User } from '../modules/users/user.entity';
import { PlatformOperatorsService } from './platform-operators.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, User])],
  providers: [
    Reflector,
    RolesGuard,
    TeamsPlanGuard,
    PlatformAdminGuard,
    PlatformOperatorGuard,
    PlatformOperatorsService,
  ],
  exports: [
    TypeOrmModule,
    RolesGuard,
    TeamsPlanGuard,
    PlatformAdminGuard,
    PlatformOperatorGuard,
    PlatformOperatorsService,
  ],
})
export class CommonModule {}
