import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './guards/roles.guard';
import { TeamsPlanGuard } from './guards/plan.guard';

@Module({
  providers: [Reflector, RolesGuard, TeamsPlanGuard],
  exports: [RolesGuard, TeamsPlanGuard],
})
export class CommonModule {}
