import {
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppointmentBookingService } from './appointment-booking.service';

describe('AppointmentBookingService calendar boundary', () => {
  const futureStart = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  const futureEnd = new Date(futureStart.getTime() + 30 * 60_000);

  function fixture(providers?: any) {
    const lead: any = {
      id: 'lead-1',
      tenantId: 'tenant-1',
      fullName: 'Controlled Lead',
      email: 'lead@example.com',
      assignedToUserId: 'user-1',
      stage: 'qualified',
    };
    const appointments = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (value) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
    };
    const leads = { findOne: jest.fn().mockResolvedValue(lead) };
    const calendar = {
      withTenantBookingLock: jest.fn(async (_tenantId, callback) => callback()),
      readyCalendarId: jest.fn().mockResolvedValue('calendar-1'),
      createBookingEvent: jest.fn().mockResolvedValue({ id: 'google-event-1', etag: 'etag-1', calendarId: 'calendar-1' }),
      updateBookingEvent: jest.fn().mockResolvedValue({ id: 'google-event-1', etag: 'etag-2' }),
      cancelBookingEvent: jest.fn().mockResolvedValue({ cancelled: true }),
      getBookingEvent: jest.fn(),
    };
    const jobs = {
      register: jest.fn(),
      schedule: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };
    const dataSource = { transaction: jest.fn() };
    const notifications = { createForTenant: jest.fn().mockResolvedValue([{ id: 'notice-1' }]) };
    const crmEvents = { publish: jest.fn().mockResolvedValue({ queued: 1 }) };
    const operations = { createTask: jest.fn() };
    const audit = { recordSystemEvent: jest.fn() };
    const onboarding = { recordUatWorkflowEvidence: jest.fn() };
    const service = new AppointmentBookingService(
      dataSource as any,
      appointments as any,
      leads as any,
      {} as any,
      {} as any,
      { findOne: jest.fn().mockResolvedValue({ timeZone: 'America/New_York' }) } as any,
      calendar as any,
      notifications as any,
      crmEvents as any,
      jobs as any,
      operations as any,
      audit as any,
      onboarding as any,
      providers,
    );
    return {
      service,
      lead,
      appointments,
      calendar,
      jobs,
      dataSource,
      notifications,
      crmEvents,
      operations,
      providers,
    };
  }

  it('keeps existing appointments bound to Google after switching new bookings to Microsoft', async () => {
    const google = {
      name: 'google_calendar',
      storedProvider: 'google',
      updateAppointment: jest.fn().mockResolvedValue({
        provider: 'google_calendar',
        storedProvider: 'google',
        connectionId: 'google-connection-1',
        resourceId: 'google-calendar-1',
        id: 'google-event-1',
        inviteeId: null,
        version: 'google-etag-2',
        status: 'confirmed',
        startsAt: futureStart,
        endsAt: new Date(futureEnd.getTime() + 15 * 60_000),
        joinUrl: null,
        cancelUrl: null,
        rescheduleUrl: null,
        providerUpdatedAt: null,
      }),
    };
    const microsoft = {
      name: 'microsoft_calendar',
      storedProvider: 'microsoft',
      readyBinding: jest.fn().mockResolvedValue({
        provider: 'microsoft_calendar',
        storedProvider: 'microsoft',
        connectionId: 'microsoft-connection-1',
        resourceId: 'microsoft-calendar-1',
        resourceName: 'Appointments',
        timeZone: 'America/New_York',
      }),
      createAppointment: jest.fn().mockResolvedValue({
        provider: 'microsoft_calendar',
        storedProvider: 'microsoft',
        connectionId: 'microsoft-connection-1',
        resourceId: 'microsoft-calendar-1',
        id: 'microsoft-event-1',
        inviteeId: null,
        version: 'microsoft-version-1',
        status: 'confirmed',
        startsAt: futureStart,
        endsAt: futureEnd,
        joinUrl: null,
        cancelUrl: null,
        rescheduleUrl: null,
        providerUpdatedAt: null,
      }),
    };
    const providers = {
      active: jest.fn().mockResolvedValue(microsoft),
      forStoredProvider: jest.fn((provider) =>
        provider === 'google' ? google : microsoft,
      ),
      withTenantBookingLock: jest.fn(
        async (_provider, _tenantId, callback) => callback(),
      ),
    };
    const item = fixture(providers);
    const googleAppointment: any = {
      id: 'appointment-google-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      lead: item.lead,
      assignedUserId: 'user-1',
      startsAt: futureStart,
      endsAt: futureEnd,
      meetingMode: 'in_person',
      status: 'scheduled',
      externalProvider: 'google',
      externalConnectionId: 'google-connection-1',
      externalEventId: 'google-event-1',
      externalEventEtag: 'google-etag-1',
      externalCalendarId: 'google-calendar-1',
    };
    jest
      .spyOn(item.service as any, 'requireAppointmentAccess')
      .mockResolvedValue(googleAppointment);
    const newEnd = new Date(futureEnd.getTime() + 15 * 60_000);
    item.dataSource.transaction.mockResolvedValue({
      ...googleAppointment,
      endsAt: newEnd,
      externalEventEtag: 'google-etag-2',
    });

    await item.service.update('appointment-google-1', 'tenant-1', {
      endsAt: newEnd.toISOString(),
    });

    expect(providers.forStoredProvider).toHaveBeenCalledWith('google');
    expect(google.updateAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'google-event-1',
        resourceId: 'google-calendar-1',
        version: 'google-etag-1',
        start: futureStart,
        end: newEnd,
      }),
    );
    expect(google.updateAppointment.mock.calls[0][0]).not.toHaveProperty(
      'attendeeEmail',
    );
    expect(providers.active).not.toHaveBeenCalled();
    expect(microsoft.createAppointment).not.toHaveBeenCalled();

    const internal = {
      id: 'appointment-microsoft-1',
      tenantId: 'tenant-1',
      lead: item.lead,
    };
    const persist = jest
      .spyOn(item.service as any, 'createInternal')
      .mockResolvedValue(internal);
    await expect(
      item.service.create('tenant-1', {
        leadId: 'lead-1',
        startsAt: futureStart.toISOString(),
        endsAt: futureEnd.toISOString(),
        idempotencyKey: 'microsoft-request-1',
      }),
    ).resolves.toBe(internal);

    expect(providers.active).toHaveBeenCalledWith('tenant-1');
    expect(microsoft.createAppointment).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        resourceId: 'microsoft-calendar-1',
        idempotencyKey: 'manual:microsoft-request-1',
      }),
    );
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        externalProvider: 'microsoft',
        externalConnectionId: 'microsoft-connection-1',
        externalEventId: 'microsoft-event-1',
      }),
    );
  });

  it('creates Google first, then persists the internal appointment with the external ID', async () => {
    const item = fixture();
    const internal = { id: 'appointment-1', tenantId: 'tenant-1', lead: item.lead };
    const persist = jest.spyOn(item.service as any, 'createInternal').mockResolvedValue(internal);
    await expect(
      item.service.create('tenant-1', {
        leadId: 'lead-1',
        startsAt: futureStart.toISOString(),
        endsAt: futureEnd.toISOString(),
        idempotencyKey: 'request-1',
      }),
    ).resolves.toBe(internal);
    expect(item.calendar.createBookingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        calendarId: 'calendar-1',
        attendeeEmail: 'lead@example.com',
        idempotencyKey: 'manual:request-1',
      }),
    );
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        externalEventId: 'google-event-1',
        externalEventEtag: 'etag-1',
        externalCalendarId: 'calendar-1',
        idempotencyKey: 'manual:request-1',
      }),
    );
    expect(item.calendar.createBookingEvent.mock.invocationCallOrder[0]).toBeLessThan(
      persist.mock.invocationCallOrder[0],
    );
  });

  it('returns the existing appointment for a repeated idempotency key', async () => {
    const item = fixture();
    const existing: any = {
      id: 'appointment-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      lead: item.lead,
      idempotencyKey: 'manual:request-1',
      externalProvider: null,
      externalEventId: null,
      startsAt: futureStart,
      endsAt: futureEnd,
      postCommitCompletedAt: new Date(),
    };
    item.appointments.findOne.mockResolvedValue(existing);
    await expect(
      item.service.create('tenant-1', {
        leadId: 'lead-1',
        startsAt: futureStart.toISOString(),
        idempotencyKey: 'request-1',
      }),
    ).resolves.toBe(existing);
    expect(item.calendar.createBookingEvent).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key with a different time', async () => {
    const item = fixture();
    item.appointments.findOne.mockResolvedValue({
      id: 'appointment-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      lead: item.lead,
      startsAt: new Date(futureStart.getTime() + 60_000),
      endsAt: new Date(futureEnd.getTime() + 60_000),
      idempotencyKey: 'manual:request-1',
    });
    await expect(
      item.service.create('tenant-1', {
        leadId: 'lead-1',
        startsAt: futureStart.toISOString(),
        idempotencyKey: 'request-1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'APPOINTMENT_IDEMPOTENCY_CONFLICT' }),
    });
    expect(item.calendar.createBookingEvent).not.toHaveBeenCalled();
  });

  it('does not create an internal appointment when the Google result is unavailable', async () => {
    const item = fixture();
    item.calendar.createBookingEvent.mockRejectedValue(
      new ServiceUnavailableException({
        code: 'GOOGLE_CALENDAR_TIMEOUT',
        message: 'Google did not confirm the result.',
      }),
    );
    const persist = jest.spyOn(item.service as any, 'createInternal');
    await expect(
      item.service.create('tenant-1', {
        leadId: 'lead-1',
        startsAt: futureStart.toISOString(),
        idempotencyKey: 'request-1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'APPOINTMENT_RECONCILIATION_PENDING' }),
    });
    expect(persist).not.toHaveBeenCalled();
    expect(item.jobs.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'appointment.reconcile_create', maxAttempts: 8 }),
    );
  });

  it('reschedules Google before updating the internal record', async () => {
    const item = fixture();
    const appointment: any = {
      id: 'appointment-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      lead: item.lead,
      assignedUserId: 'user-1',
      startsAt: futureStart,
      endsAt: futureEnd,
      status: 'scheduled',
      externalProvider: 'google',
      externalEventId: 'google-event-1',
      externalEventEtag: 'etag-1',
      externalCalendarId: 'calendar-1',
    };
    jest.spyOn(item.service as any, 'requireAppointmentAccess').mockResolvedValue(appointment);
    const newStart = new Date(futureStart.getTime() + 24 * 60 * 60_000);
    const saved = { ...appointment, startsAt: newStart, endsAt: new Date(newStart.getTime() + 30 * 60_000) };
    item.dataSource.transaction.mockResolvedValue(saved);
    await item.service.update('appointment-1', 'tenant-1', {
      startsAt: newStart.toISOString(),
    });
    expect(item.calendar.updateBookingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'google-event-1', start: newStart }),
    );
    expect(item.calendar.updateBookingEvent.mock.invocationCallOrder[0]).toBeLessThan(
      item.dataSource.transaction.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ['start time only', 24 * 60 * 60_000, 24 * 60 * 60_000, true, false],
    ['end time only', 0, 30 * 60_000, false, true],
    ['both start and end', 24 * 60 * 60_000, 25 * 60 * 60_000, true, true],
    ['a duration decrease', 0, -10 * 60_000, false, true],
  ])(
    'updates Google first when %s changes',
    async (_label, startDelta, endDelta, includeStart, includeEnd) => {
      const item = fixture();
      const appointment: any = {
        id: 'appointment-1',
        tenantId: 'tenant-1',
        leadId: 'lead-1',
        lead: item.lead,
        assignedUserId: 'user-1',
        startsAt: futureStart,
        endsAt: futureEnd,
        status: 'scheduled',
        externalProvider: 'google',
        externalEventId: 'google-event-1',
        externalEventEtag: 'etag-1',
        externalCalendarId: 'calendar-1',
      };
      jest
        .spyOn(item.service as any, 'requireAppointmentAccess')
        .mockResolvedValue(appointment);
      const requestedStart = new Date(futureStart.getTime() + startDelta);
      const requestedEnd = new Date(futureEnd.getTime() + endDelta);
      const expectedEnd = includeEnd
        ? requestedEnd
        : new Date(
            requestedStart.getTime() +
              (futureEnd.getTime() - futureStart.getTime()),
          );
      item.dataSource.transaction.mockResolvedValue({
        ...appointment,
        startsAt: requestedStart,
        endsAt: expectedEnd,
      });
      await item.service.update('appointment-1', 'tenant-1', {
        startsAt: includeStart ? requestedStart.toISOString() : undefined,
        endsAt: includeEnd ? requestedEnd.toISOString() : undefined,
      });
      expect(item.calendar.updateBookingEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'google-event-1',
          start: requestedStart,
          end: expectedEnd,
        }),
      );
      expect(
        item.calendar.updateBookingEvent.mock.invocationCallOrder[0],
      ).toBeLessThan(item.dataSource.transaction.mock.invocationCallOrder[0]);
    },
  );

  it('rejects a colliding duration increase without changing either record', async () => {
    const item = fixture();
    const appointment: any = {
      id: 'appointment-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      lead: item.lead,
      assignedUserId: 'user-1',
      startsAt: futureStart,
      endsAt: futureEnd,
      status: 'scheduled',
      syncStatus: 'synced',
      externalProvider: 'google',
      externalEventId: 'google-event-1',
      externalEventEtag: 'etag-1',
      externalCalendarId: 'calendar-1',
    };
    jest
      .spyOn(item.service as any, 'requireAppointmentAccess')
      .mockResolvedValue(appointment);
    item.calendar.updateBookingEvent.mockRejectedValue(
      new ConflictException({
        code: 'CALENDAR_TIME_UNAVAILABLE',
        message: 'That time is busy.',
      }),
    );
    await expect(
      item.service.update('appointment-1', 'tenant-1', {
        endsAt: new Date(futureEnd.getTime() + 30 * 60_000).toISOString(),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CALENDAR_TIME_UNAVAILABLE' }),
    });
    expect(item.dataSource.transaction).not.toHaveBeenCalled();
    expect(item.appointments.update).not.toHaveBeenCalled();
  });

  it('does not call Google when appointment timing did not change', async () => {
    const item = fixture();
    const appointment: any = {
      id: 'appointment-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      lead: item.lead,
      assignedUserId: 'user-1',
      startsAt: futureStart,
      endsAt: futureEnd,
      status: 'scheduled',
      externalProvider: 'google',
      externalEventId: 'google-event-1',
      externalEventEtag: 'etag-1',
      externalCalendarId: 'calendar-1',
    };
    jest
      .spyOn(item.service as any, 'requireAppointmentAccess')
      .mockResolvedValue(appointment);
    item.dataSource.transaction.mockResolvedValue({
      ...appointment,
      notes: 'Updated note',
    });
    await item.service.update('appointment-1', 'tenant-1', {
      notes: 'Updated note',
    });
    expect(item.calendar.updateBookingEvent).not.toHaveBeenCalled();
    expect(item.calendar.cancelBookingEvent).not.toHaveBeenCalled();
  });

  it('does not update the internal duration when Google fails an end-time-only change', async () => {
    const item = fixture();
    const appointment: any = {
      id: 'appointment-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      lead: item.lead,
      assignedUserId: 'user-1',
      startsAt: futureStart,
      endsAt: futureEnd,
      status: 'scheduled',
      externalProvider: 'google',
      externalEventId: 'google-event-1',
      externalEventEtag: 'etag-1',
      externalCalendarId: 'calendar-1',
    };
    jest
      .spyOn(item.service as any, 'requireAppointmentAccess')
      .mockResolvedValue(appointment);
    item.calendar.updateBookingEvent.mockRejectedValue(
      new ServiceUnavailableException({
        code: 'GOOGLE_CALENDAR_TEMPORARY_FAILURE',
        message: 'Google is unavailable.',
      }),
    );
    await expect(
      item.service.update('appointment-1', 'tenant-1', {
        endsAt: new Date(futureEnd.getTime() + 15 * 60_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(item.dataSource.transaction).not.toHaveBeenCalled();
    expect(item.appointments.update).toHaveBeenCalledWith(
      { id: 'appointment-1', tenantId: 'tenant-1' },
      expect.objectContaining({
        syncStatus: 'needs_attention',
        syncErrorCode: 'GOOGLE_CALENDAR_TEMPORARY_FAILURE',
      }),
    );
  });

  it('refreshes a stale event ETag and retries without overwriting attendees', async () => {
    const item = fixture();
    const appointment: any = {
      id: 'appointment-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      lead: item.lead,
      assignedUserId: 'user-1',
      startsAt: futureStart,
      endsAt: futureEnd,
      status: 'scheduled',
      externalProvider: 'google',
      externalEventId: 'google-event-1',
      externalEventEtag: 'etag-1',
      externalCalendarId: 'calendar-1',
    };
    jest
      .spyOn(item.service as any, 'requireAppointmentAccess')
      .mockResolvedValue(appointment);
    const newEnd = new Date(futureEnd.getTime() + 15 * 60_000);
    item.calendar.updateBookingEvent
      .mockRejectedValueOnce(
        new ConflictException({
          code: 'GOOGLE_CALENDAR_CHANGED',
          message: 'The event changed.',
        }),
      )
      .mockResolvedValueOnce({
        id: 'google-event-1',
        etag: 'etag-3',
        startsAt: futureStart,
        endsAt: newEnd,
      });
    item.calendar.getBookingEvent.mockResolvedValue({
      id: 'google-event-1',
      etag: 'etag-2',
      status: 'confirmed',
      startsAt: futureStart,
      endsAt: futureEnd,
    });
    item.dataSource.transaction.mockResolvedValue({
      ...appointment,
      endsAt: newEnd,
      externalEventEtag: 'etag-3',
    });
    await item.service.update('appointment-1', 'tenant-1', {
      endsAt: newEnd.toISOString(),
    });
    expect(item.calendar.getBookingEvent).toHaveBeenCalledTimes(1);
    expect(item.calendar.updateBookingEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ etag: 'etag-2', end: newEnd }),
    );
    expect(item.calendar.updateBookingEvent.mock.calls[1][0]).not.toHaveProperty(
      'attendeeEmail',
    );
    expect(item.appointments.update).not.toHaveBeenCalled();
  });

  it('reconciles an externally rescheduled event without disabling unrelated bookings', async () => {
    const item = fixture();
    const appointment: any = {
      id: 'appointment-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      lead: item.lead,
      assignedUserId: 'user-1',
      startsAt: futureStart,
      endsAt: futureEnd,
      status: 'scheduled',
      externalProvider: 'google',
      externalEventId: 'google-event-1',
      externalEventEtag: 'etag-1',
      externalCalendarId: 'calendar-1',
    };
    jest
      .spyOn(item.service as any, 'requireAppointmentAccess')
      .mockResolvedValue(appointment);
    item.calendar.updateBookingEvent.mockRejectedValue(
      new ConflictException({
        code: 'GOOGLE_CALENDAR_CHANGED',
        message: 'The event changed.',
      }),
    );
    const providerStart = new Date(futureStart.getTime() + 60 * 60_000);
    const providerEnd = new Date(futureEnd.getTime() + 60 * 60_000);
    const external = {
      id: 'google-event-1',
      etag: 'etag-2',
      status: 'confirmed',
      startsAt: providerStart,
      endsAt: providerEnd,
    };
    item.calendar.getBookingEvent.mockResolvedValue(external);
    const reconcile = jest
      .spyOn(item.service as any, 'reconcileExternalGoogleState')
      .mockResolvedValue({ ...appointment, ...external });
    await expect(
      item.service.update('appointment-1', 'tenant-1', {
        endsAt: new Date(futureEnd.getTime() + 15 * 60_000).toISOString(),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'APPOINTMENT_EXTERNAL_CHANGE_RECONCILED',
      }),
    });
    expect(reconcile).toHaveBeenCalledWith(appointment, external);
    expect(item.appointments.update).not.toHaveBeenCalled();
    expect(item.calendar.readyCalendarId).not.toHaveBeenCalled();
  });

  it('cancels Google before marking the internal appointment cancelled', async () => {
    const item = fixture();
    const appointment: any = {
      id: 'appointment-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      lead: item.lead,
      assignedUserId: 'user-1',
      startsAt: futureStart,
      endsAt: futureEnd,
      status: 'scheduled',
      externalProvider: 'google',
      externalEventId: 'google-event-1',
      externalEventEtag: 'etag-1',
      externalCalendarId: 'calendar-1',
    };
    jest.spyOn(item.service as any, 'requireAppointmentAccess').mockResolvedValue(appointment);
    item.dataSource.transaction.mockResolvedValue({ ...appointment, status: 'cancelled' });
    await item.service.update('appointment-1', 'tenant-1', { status: 'cancelled' });
    expect(item.calendar.cancelBookingEvent).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      eventId: 'google-event-1',
      etag: 'etag-1',
      calendarId: 'calendar-1',
    });
    expect(item.calendar.cancelBookingEvent.mock.invocationCallOrder[0]).toBeLessThan(
      item.dataSource.transaction.mock.invocationCallOrder[0],
    );
  });

  it('marks the appointment and opens an operations task when reconciliation cannot verify Google', async () => {
    const item = fixture();
    const appointment: any = {
      id: 'appointment-1',
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      lead: item.lead,
      startsAt: futureStart,
      endsAt: futureEnd,
      status: 'scheduled',
      externalProvider: 'google',
      externalEventId: 'google-event-1',
      externalCalendarId: 'calendar-1',
    };
    item.appointments.findOne.mockResolvedValue(appointment);
    item.calendar.getBookingEvent.mockRejectedValue(
      new ServiceUnavailableException({
        code: 'GOOGLE_CALENDAR_TEMPORARY_FAILURE',
        message: 'Google Calendar is unavailable.',
      }),
    );
    item.service.onModuleInit();
    const handler = item.jobs.register.mock.calls.find(
      ([taskType]) => taskType === 'appointment.reconcile_calendar',
    )?.[1];
    await expect(
      handler({
        tenantId: 'tenant-1',
        payload: { appointmentId: 'appointment-1' },
        attemptCount: 1,
        maxAttempts: 12,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(item.appointments.update).toHaveBeenCalledWith(
      { id: 'appointment-1', tenantId: 'tenant-1' },
      expect.objectContaining({
        syncStatus: 'needs_attention',
        syncErrorCode: 'GOOGLE_CALENDAR_TEMPORARY_FAILURE',
      }),
    );
    expect(item.operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        relatedEntityId: 'appointment-1',
      }),
    );
  });
});
