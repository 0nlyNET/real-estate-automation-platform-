import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { OperationsModule } from '../operations/operations.module';
import { Appointment } from '../client-operations/appointment.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { BookingProviderRegistry } from './booking-provider.registry';
import { BookingWebhookReceipt } from './booking-webhook-receipt.entity';
import { CalendlyClient } from './calendly.client';
import { CalendlyService } from './calendly.service';
import { CalendarConnection } from './calendar-connection.entity';
import { CalendarController } from './calendar.controller';
import { CalendarOAuthState } from './calendar-oauth-state.entity';
import { CalendarService } from './calendar.service';
import { GoogleCalendarClient } from './google-calendar.client';
import { GoogleBookingProviderAdapter } from './google-booking-provider.adapter';
import { MicrosoftCalendarClient } from './microsoft-calendar.client';
import { MicrosoftCalendarService } from './microsoft-calendar.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CalendarConnection,
      CalendarOAuthState,
      Appointment,
      TenantSettings,
      BookingWebhookReceipt,
    ]),
    AuditModule,
    OperationsModule,
  ],
  controllers: [CalendarController],
  providers: [
    CalendarService,
    GoogleCalendarClient,
    GoogleBookingProviderAdapter,
    MicrosoftCalendarClient,
    MicrosoftCalendarService,
    CalendlyClient,
    CalendlyService,
    BookingProviderRegistry,
  ],
  exports: [
    CalendarService,
    GoogleBookingProviderAdapter,
    MicrosoftCalendarService,
    CalendlyService,
    BookingProviderRegistry,
    TypeOrmModule,
  ],
})
export class CalendarModule {}
