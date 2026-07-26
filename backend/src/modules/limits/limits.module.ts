import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { LimitsService } from './limits.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant])],
  providers: [LimitsService],
  exports: [LimitsService],
})
export class LimitsModule {}
