import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Message } from '../messaging/message.entity';
import { Appointment } from './appointment.entity';
import {
  AdminClientOperationsController,
  ClientOperationsController,
} from './client-operations.controller';
import { ClientOperationsService } from './client-operations.service';
import { LeadHandoff } from './lead-handoff.entity';
import { AppointmentBookingService } from './appointment-booking.service';
import { CalendarModule } from '../calendar/calendar.module';
import { AuditModule } from '../audit/audit.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { LeadStageEvent } from '../leads/lead-stage-event.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { DurableJob } from '../durable-jobs/durable-job.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LeadHandoff,
      Appointment,
      Lead,
      Message,
      LeadEvent,
      LeadStageEvent,
      TenantSettings,
      DurableJob,
    ]),
    CalendarModule,
    AuditModule,
    OnboardingModule,
  ],
  controllers: [ClientOperationsController, AdminClientOperationsController],
  providers: [ClientOperationsService, AppointmentBookingService],
  exports: [ClientOperationsService],
})
export class ClientOperationsModule {}
