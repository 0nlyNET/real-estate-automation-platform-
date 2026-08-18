import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BookingProviderAdapter,
  CancelProviderAppointmentInput,
  CreateProviderAppointmentInput,
  ProviderAppointment,
  ProviderStatus,
  UpdateProviderAppointmentInput,
} from './booking-provider.types';
import { CalendarConnection } from './calendar-connection.entity';
import { CalendarService } from './calendar.service';

@Injectable()
export class GoogleBookingProviderAdapter implements BookingProviderAdapter {
  readonly name = 'google_calendar' as const;
  readonly storedProvider = 'google' as const;

  constructor(
    private readonly calendar: CalendarService,
    @InjectRepository(CalendarConnection)
    private readonly connections: Repository<CalendarConnection>,
  ) {}

  async status(tenantId: string): Promise<ProviderStatus> {
    const status = await this.calendar.status(tenantId);
    const connectionStatus: ProviderStatus['status'] =
      status.status === 'choose_calendar'
        ? 'choose_resource'
        : status.status === 'configured' ||
            status.status === 'connected' ||
            status.status === 'needs_attention' ||
            status.status === 'disconnected'
          ? status.status
          : status.connected
            ? 'connected'
            : 'disconnected';
    const notificationStatus: ProviderStatus['changeNotifications']['status'] =
      status.changeNotifications.status === 'active'
        ? 'active'
        : status.changeNotifications.status === 'reconciliation_only'
          ? 'reconciliation_only'
          : 'not_supported';
    return {
      provider: this.name,
      status: connectionStatus,
      connected: status.connected,
      selectedResource: status.selectedCalendar
        ? {
            ...status.selectedCalendar,
            type: 'calendar',
          }
        : null,
      lastTestedAt: status.lastTestedAt,
      lastSuccessfulSyncAt: status.lastSuccessfulSyncAt,
      changeNotifications: {
        status: notificationStatus,
        expiresAt: status.changeNotifications.expiresAt,
      },
      capabilities: {
        directBooking: true,
        automatedReschedule: true,
        cancellation: true,
        onlineMeeting: false,
        changeNotifications: true,
      },
      issue: status.issue,
    };
  }

  async readyBinding(tenantId: string) {
    const resourceId = await this.calendar.readyCalendarId(tenantId);
    const connection = await this.connections.findOne({
      where: { tenantId, provider: 'google' },
    });
    if (!connection) {
      throw new ConflictException({
        code: 'CALENDAR_NOT_CONNECTED',
        message: 'Connect and test Google Calendar before scheduling.',
      });
    }
    return {
      provider: this.name,
      storedProvider: this.storedProvider,
      connectionId: connection.id,
      resourceId,
      resourceName: connection.selectedCalendarName || 'Google Calendar',
      timeZone: connection.selectedCalendarTimeZone || 'UTC',
    };
  }

  checkAvailability(
    tenantId: string,
    start: Date,
    end: Date,
    excludeEventId?: string | null,
    resourceId?: string | null,
  ) {
    return this.calendar.checkAvailability(
      tenantId,
      start,
      end,
      excludeEventId,
      resourceId,
    );
  }

  async createAppointment(input: CreateProviderAppointmentInput) {
    const binding = await this.readyBinding(input.tenantId);
    const event = await this.calendar.createBookingEvent({
      tenantId: input.tenantId,
      calendarId: input.resourceId || binding.resourceId,
      leadId: input.leadId,
      start: input.start,
      end: input.end,
      summary: input.summary,
      description: input.description,
      attendeeEmail: input.attendeeEmail,
      idempotencyKey: input.idempotencyKey,
    });
    return this.external(binding.connectionId, event);
  }

  async getAppointment(
    tenantId: string,
    eventId: string,
    resourceId?: string | null,
  ) {
    const binding = await this.readyBinding(tenantId);
    const event = await this.calendar.getBookingEvent(
      tenantId,
      eventId,
      resourceId,
    );
    return event ? this.external(binding.connectionId, event) : null;
  }

  async updateAppointment(input: UpdateProviderAppointmentInput) {
    const binding = await this.readyBinding(input.tenantId);
    const event = await this.calendar.updateBookingEvent({
      tenantId: input.tenantId,
      eventId: input.eventId,
      calendarId: input.resourceId,
      etag: input.version,
      start: input.start,
      end: input.end,
    });
    return this.external(binding.connectionId, event);
  }

  async cancelAppointment(input: CancelProviderAppointmentInput) {
    await this.calendar.cancelBookingEvent({
      tenantId: input.tenantId,
      eventId: input.eventId,
      calendarId: input.resourceId,
      etag: input.version,
    });
    return { cancelled: true as const };
  }

  private external(
    connectionId: string,
    event: {
      id: string;
      calendarId: string;
      etag: string | null;
      status: string;
      startsAt: Date | null;
      endsAt: Date | null;
    },
  ): ProviderAppointment {
    return {
      provider: this.name,
      storedProvider: this.storedProvider,
      connectionId,
      resourceId: event.calendarId,
      id: event.id,
      inviteeId: null,
      version: event.etag,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      joinUrl: null,
      cancelUrl: null,
      rescheduleUrl: null,
      providerUpdatedAt: null,
    };
  }
}
