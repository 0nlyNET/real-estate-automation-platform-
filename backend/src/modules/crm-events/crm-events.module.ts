import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationsModule } from '../operations/operations.module';
import { CrmEventsService } from './crm-events.service';
import { IntegrationDeliveryEvent } from './integration-delivery-event.entity';
import { TenantWebhookSubscription } from './tenant-webhook-subscription.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([IntegrationDeliveryEvent, TenantWebhookSubscription]),
    OperationsModule,
  ],
  providers: [CrmEventsService],
  exports: [CrmEventsService],
})
export class CrmEventsModule {}
