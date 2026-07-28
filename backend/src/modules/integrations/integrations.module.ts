import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Credential } from '../settings/credential.entity';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { CommonModule } from '../../common/common.module';
import { OperationsModule } from '../operations/operations.module';
import { PlatformCredential } from './platform-credential.entity';
import { PlatformIntegrationsService } from './platform-integrations.service';
import {
  AdminSalesBookingController,
  PublicSalesBookingController,
} from './sales-booking.controller';
import { SalesBookingService } from './sales-booking.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Credential, PlatformCredential]),
    CommonModule,
    OperationsModule,
  ],
  controllers: [
    IntegrationsController,
    AdminSalesBookingController,
    PublicSalesBookingController,
  ],
  providers: [IntegrationsService, PlatformIntegrationsService, SalesBookingService],
  exports: [IntegrationsService, PlatformIntegrationsService, SalesBookingService],
})
export class IntegrationsModule {}
