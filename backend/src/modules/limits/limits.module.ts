import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../leads/lead.entity';
import { Tenant } from '../tenants/tenant.entity';
import { LimitsService } from './limits.service';

@Module({
  imports: [TypeOrmModule.forFeature([Lead, Tenant])],
  providers: [LimitsService],
  exports: [LimitsService],
})
export class LimitsModule {}
