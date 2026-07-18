import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [TenantsModule, CommonModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
