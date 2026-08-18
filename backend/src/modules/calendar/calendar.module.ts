import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { OperationsModule } from '../operations/operations.module';
import { CalendarConnection } from './calendar-connection.entity';
import { CalendarController } from './calendar.controller';
import { CalendarOAuthState } from './calendar-oauth-state.entity';
import { CalendarService } from './calendar.service';
import { GoogleCalendarClient } from './google-calendar.client';

@Module({
  imports: [
    TypeOrmModule.forFeature([CalendarConnection, CalendarOAuthState]),
    AuditModule,
    OperationsModule,
  ],
  controllers: [CalendarController],
  providers: [CalendarService, GoogleCalendarClient],
  exports: [CalendarService, TypeOrmModule],
})
export class CalendarModule {}
