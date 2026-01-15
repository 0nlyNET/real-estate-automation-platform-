import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [TenantsModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
