import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { EntitlementService } from './entitlement.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TenantSettings])],
  providers: [EntitlementService],
  exports: [EntitlementService],
})
export class EntitlementsModule {}
