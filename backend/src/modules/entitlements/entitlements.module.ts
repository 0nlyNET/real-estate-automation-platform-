import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { OperatorTestModule } from '../messaging/operator-test.module';
import { EntitlementService } from './entitlement.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TenantSettings]), OperatorTestModule],
  providers: [EntitlementService],
  exports: [EntitlementService, OperatorTestModule],
})
export class EntitlementsModule {}
