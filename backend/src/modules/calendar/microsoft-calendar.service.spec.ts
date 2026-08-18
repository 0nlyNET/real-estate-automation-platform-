import { createHash } from 'crypto';
import { decryptString, encryptString } from '../../common/crypto-secrets';
import { BookingProviderApiError } from './booking-provider.error';
import { MicrosoftCalendarService } from './microsoft-calendar.service';

describe('MicrosoftCalendarService', () => {
  const originalEnv = { ...process.env };

  function fixture(overrides: Record<string, unknown> = {}) {
    const connection: any = {
      id: 'connection-1',
      tenantId: 'tenant-1',
      provider: 'microsoft',
      accessTokenEncrypted: encryptString('access-token'),
      refreshTokenEncrypted: encryptString('refresh-token'),
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      refreshTokenExpiresAt: null,
      grantedScopes: [],
      providerAccountId: 'account-1',
      providerTenantId: 'organization-1',
      status: 'connected',
      selectedCalendarId: 'calendar-1',
      selectedCalendarName: 'Appointments',
      selectedCalendarTimeZone: 'America/New_York',
      selectedResourceType: 'calendar',
      selectedResourceUri: 'calendar-1',
      selectedResourceMetadata: {
        accountAddress: 'agent@example.com',
        teamsSupported: true,
      },
      webhookChannelId: 'subscription-1',
      webhookResourceId: 'users/account-1/events',
      webhookTokenHash: createHash('sha256')
        .update('client-state')
        .digest('hex'),
      webhookSecretEncrypted: null,
      webhookExpiresAt: new Date(Date.now() + 3_600_000),
      webhookLastMessageNumber: null,
      lastTestedAt: new Date(),
      lastSuccessfulSyncAt: new Date(),
      lastErrorCode: null,
      lastErrorAt: null,
      disconnectedAt: null,
      ...overrides,
    };
    const connections = {
      findOne: jest.fn().mockResolvedValue(connection),
      create: jest.fn((value) => ({ id: 'connection-new', ...value })),
      save: jest.fn(async (value) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const oauthStates = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const webhookReceipts = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const appointments = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };
    const graph = {
      authorizationUrl: jest.fn(),
      exchangeCode: jest.fn(),
      refreshAccessToken: jest.fn(),
      getProfile: jest.fn(),
      getMailboxTimeZone: jest.fn().mockResolvedValue('America/New_York'),
      listCalendars: jest.fn(),
      getCalendar: jest.fn(),
      getSchedule: jest.fn().mockResolvedValue([]),
      listCalendarView: jest.fn().mockResolvedValue([]),
      createEvent: jest.fn(),
      getEvent: jest.fn().mockResolvedValue(null),
      patchEvent: jest.fn(),
      deleteEvent: jest.fn(),
      createSubscription: jest.fn(),
      renewSubscription: jest.fn(),
      deleteSubscription: jest.fn(),
      transactionId: jest
        .fn()
        .mockReturnValue('deterministic-transaction-id'),
      eventTimes: jest.fn((event) => ({
        startsAt: event.start?.dateTime
          ? new Date(event.start.dateTime)
          : null,
        endsAt: event.end?.dateTime ? new Date(event.end.dateTime) : null,
      })),
    };
    const audit = {
      record: jest.fn().mockResolvedValue({}),
      recordSystemEvent: jest.fn().mockResolvedValue({}),
    };
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
    const durableJobs = {
      register: jest.fn(),
      schedule: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };
    const dataSource = { transaction: jest.fn() };
    const service = new MicrosoftCalendarService(
      dataSource as any,
      connections as any,
      oauthStates as any,
      webhookReceipts as any,
      appointments as any,
      graph as any,
      audit as any,
      operations as any,
      durableJobs as any,
    );
    return {
      service,
      connection,
      connections,
      webhookReceipts,
      appointments,
      graph,
      audit,
      operations,
      durableJobs,
    };
  }

  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      'base64',
    );
    process.env.MICROSOFT_CALENDAR_CLIENT_ID = 'microsoft-client';
    process.env.MICROSOFT_CALENDAR_CLIENT_SECRET = 'microsoft-secret';
    process.env.PUBLIC_API_URL = 'https://api.example.com';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('fails closed when the provider is disconnected or untested', async () => {
    const disconnected = fixture({ status: 'disconnected' });
    await expect(
      disconnected.service.readyBinding('tenant-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CALENDAR_NOT_CONNECTED' }),
    });

    const untested = fixture({ status: 'configured', lastTestedAt: null });
    await expect(untested.service.readyBinding('tenant-1')).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          code: 'CALENDAR_NEEDS_ATTENTION',
        }),
      },
    );
  });

  it('checks selected-calendar events and authoritative mailbox free/busy before allowing a slot', async () => {
    const item = fixture();
    const start = new Date('2027-01-10T14:00:00Z');
    const end = new Date('2027-01-10T14:30:00Z');
    await expect(
      item.service.checkAvailability('tenant-1', start, end),
    ).resolves.toMatchObject({ available: true });
    expect(item.graph.listCalendarView).toHaveBeenCalledWith('access-token', {
      calendarId: 'calendar-1',
      start,
      end,
    });
    expect(item.graph.getSchedule).toHaveBeenCalledWith('access-token', {
      address: 'agent@example.com',
      start,
      end,
      timeZone: 'UTC',
    });

    item.graph.getSchedule.mockResolvedValueOnce([
      { status: 'busy', start, end },
    ]);
    await expect(
      item.service.checkAvailability('tenant-1', start, end),
    ).resolves.toMatchObject({ available: false });
  });

  it('creates Microsoft first and requires a confirmed Teams join URL for virtual meetings', async () => {
    const item = fixture();
    const start = new Date('2027-01-10T14:00:00Z');
    const end = new Date('2027-01-10T14:30:00Z');
    item.graph.createEvent.mockResolvedValue({
      id: 'event-1',
      '@odata.etag': 'etag-1',
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      onlineMeeting: {
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/verified',
      },
    });
    await expect(
      item.service.createAppointment({
        tenantId: 'tenant-1',
        leadId: 'lead-1',
        start,
        end,
        timeZone: 'America/New_York',
        summary: 'Appointment',
        description: 'Controlled test',
        attendeeName: 'Jordan Lead',
        attendeeEmail: 'lead@example.com',
        idempotencyKey: 'appointment-key',
        mode: 'virtual',
      }),
    ).resolves.toMatchObject({
      id: 'event-1',
      storedProvider: 'microsoft',
      version: 'etag-1',
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/verified',
    });
    expect(item.graph.createEvent).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({
        calendarId: 'calendar-1',
        attendeeEmail: 'lead@example.com',
        transactionId: 'deterministic-transaction-id',
        virtual: true,
      }),
    );
  });

  it('keeps an event-level version conflict from disabling unrelated bookings', async () => {
    const item = fixture();
    const oldStart = new Date('2027-01-10T14:00:00Z');
    const oldEnd = new Date('2027-01-10T14:30:00Z');
    const newEnd = new Date('2027-01-10T15:00:00Z');
    item.graph.getEvent.mockResolvedValue({
      id: 'event-1',
      start: { dateTime: oldStart.toISOString() },
      end: { dateTime: oldEnd.toISOString() },
    });
    item.graph.getSchedule.mockResolvedValue([
      { status: 'busy', start: oldStart, end: oldEnd },
    ]);
    item.graph.patchEvent.mockRejectedValue(
      new BookingProviderApiError(
        'microsoft_calendar',
        'MICROSOFT_EVENT_CHANGED',
        'stale event',
        412,
        false,
      ),
    );
    await expect(
      item.service.updateAppointment({
        tenantId: 'tenant-1',
        eventId: 'event-1',
        resourceId: 'calendar-1',
        version: 'stale-etag',
        start: oldStart,
        end: newEnd,
        timeZone: 'UTC',
        mode: 'in_person',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MICROSOFT_EVENT_CHANGED' }),
    });
    expect(
      item.connections.update.mock.calls.some(
        ([, update]) => update.status === 'needs_attention',
      ),
    ).toBe(false);
  });

  it('rotates refresh tokens atomically and never returns encrypted values', async () => {
    const item = fixture({ accessTokenExpiresAt: new Date(0) });
    item.graph.refreshAccessToken.mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
    });
    await expect((item.service as any).accessToken(item.connection)).resolves.toBe(
      'new-access-token',
    );
    const update = item.connections.update.mock.calls.at(-1)?.[1];
    expect(decryptString(update.accessTokenEncrypted)).toBe('new-access-token');
    expect(decryptString(update.refreshTokenEncrypted)).toBe(
      'new-refresh-token',
    );
  });

  it('validates clientState, deduplicates notifications, and schedules tenant-scoped reconciliation', async () => {
    const item = fixture();
    item.appointments.findOne.mockResolvedValue({
      id: 'appointment-1',
      tenantId: 'tenant-1',
    });
    await expect(
      item.service.handleNotifications([
        {
          id: 'notification-1',
          subscriptionId: 'subscription-1',
          clientState: 'client-state',
          changeType: 'updated',
          resourceData: { id: 'event-1' },
        },
      ]),
    ).resolves.toEqual({ accepted: true, scheduled: 1, duplicates: 0 });
    expect(item.appointments.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          externalProvider: 'microsoft',
          externalEventId: 'event-1',
        }),
      }),
    );
    expect(item.durableJobs.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        payload: { appointmentId: 'appointment-1' },
      }),
    );

    await expect(
      item.service.handleNotifications([
        {
          subscriptionId: 'subscription-1',
          clientState: 'wrong-state',
        },
      ]),
    ).rejects.toThrow('Invalid Microsoft calendar notification client state');

    item.webhookReceipts.save.mockRejectedValueOnce({ code: '23505' });
    await expect(
      item.service.handleNotifications([
        {
          id: 'notification-1',
          subscriptionId: 'subscription-1',
          clientState: 'client-state',
          resourceData: { id: 'event-1' },
        },
      ]),
    ).resolves.toEqual({ accepted: true, scheduled: 0, duplicates: 1 });
  });
});
