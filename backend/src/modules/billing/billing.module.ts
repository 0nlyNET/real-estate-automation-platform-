import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { CommonModule } from '../../common/common.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StripeWebhookEvent } from './stripe-webhook-event.entity';
import { Tenant } from '../tenants/tenant.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';

@Module({
  imports: [
    TenantsModule,
    CommonModule,
    TypeOrmModule.forFeature([StripeWebhookEvent, Tenant, TenantSettings]),
  ],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
