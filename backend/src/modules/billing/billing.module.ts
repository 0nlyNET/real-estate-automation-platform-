import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingReconciliationService } from './billing-reconciliation.service';
import { CommonModule } from '../../common/common.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StripeWebhookEvent } from './stripe-webhook-event.entity';
import { Tenant } from '../tenants/tenant.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { BillingEvent } from './billing-event.entity';
import { ServiceControlModule } from '../service-control/service-control.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    TenantsModule,
    CommonModule,
    ServiceControlModule,
    IntegrationsModule,
    TypeOrmModule.forFeature([StripeWebhookEvent, BillingEvent, Tenant, TenantSettings]),
  ],
  controllers: [BillingController],
  providers: [BillingService, BillingReconciliationService],
})
export class BillingModule {}
