import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgencyController } from './agency.controller';
import { AgencyService } from './agency.service';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { Tenant } from '../tenants/tenant.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Message } from '../messaging/message.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TenantSettings, Message]), AuthModule, TenantsModule],
  controllers: [AgencyController],
  providers: [AgencyService],
})
export class AgencyModule {}
