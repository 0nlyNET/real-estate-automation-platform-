import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { decryptString, encryptString } from '../../common/crypto-secrets';
import { CalendarService } from './calendar.service';
import {
  GOOGLE_CALENDAR_SCOPES,
  GoogleCalendarApiError,
} from './google-calendar.client';

describe('CalendarService production behavior', () => {
  const originalEnv = { ...process.env };

  function fixture(overrides: Record<string, unknown> = {}) {
    const connection: any = {
      id: 'connection-1',
      tenantId: 'tenant-1',
      provider: 'google',
      accessTokenEncrypted: encryptString('current-access-token'),
      refreshTokenEncrypted: encryptString('refresh-token'),
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      refreshTokenExpiresAt: null,
      grantedScopes: [],
      status: 'connected',
      selectedCalendarId: 'calendar@example.com',
      selectedCalendarName: 'Appointments',
      selectedCalendarTimeZone: 'America/New_York',
      lastTestedAt: new Date(),
      lastSuccessfulSyncAt: new Date(),
      lastErrorCode: null,
      lastErrorAt: null,
      webhookChannelId: null,
      webhookResourceId: null,
      webhookTokenHash: null,
      webhookExpiresAt: null,
      webhookLastMessageNumber: null,
    };
    Object.assign(connection, overrides);
    const connections = {
      findOne: jest.fn().mockResolvedValue(connection),
      create: jest.fn((value) => ({ id: 'connection-new', ...value })),
      save: jest.fn(async (value) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const oauthStates = {
      create: jest.fn((value) => ({ id: 'state-1', ...value })),
      save: jest.fn(async (value) => value),
    };
    const google = {
      authorizationUrl: jest.fn().mockReturnValue('https://accounts.google.com/oauth'),
      exchangeCode: jest.fn(),
      refreshAccessToken: jest.fn(),
      revokeToken: jest.fn().mockResolvedValue(undefined),
      listCalendars: jest.fn(),
      getCalendar: jest.fn(),
      freeBusy: jest.fn().mockResolvedValue([]),
      listEvents: jest.fn().mockResolvedValue([]),
      getEvent: jest.fn(),
      insertEvent: jest.fn(),
      patchEvent: jest.fn(),
      deleteEvent: jest.fn(),
      watchEvents: jest.fn().mockImplementation(async (_token, input) => ({
        id: input.channelId,
        resourceId: 'google-resource-1',
        expiration: String(Date.now() + 7 * 24 * 60 * 60_000),
      })),
      stopChannel: jest.fn().mockResolvedValue(undefined),
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
    const appointments = { find: jest.fn().mockResolvedValue([]) };
    const dataSource = {
      transaction: jest.fn(async (callback) =>
        callback({ query: jest.fn(), getRepository: jest.fn() }),
      ),
    };
    const service = new CalendarService(
      dataSource as any,
      connections as any,
      oauthStates as any,
      google as any,
      audit as any,
      operations as any,
      durableJobs as any,
      appointments as any,
    );
    return {
      service,
      connection,
      connections,
      oauthStates,
      google,
      audit,
      operations,
      durableJobs,
      appointments,
      dataSource,
    };
  }

  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'google-client';
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'google-secret';
    process.env.PUBLIC_API_URL = 'https://api.example.com';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('stores a one-time encrypted OAuth state and never passes the verifier to audit logs', async () => {
    const item = fixture({ status: 'disconnected' });
    await expect(
      item.service.startGoogleOAuth('tenant-1', 'user-1'),
    ).resolves.toEqual({ url: 'https://accounts.google.com/oauth' });
    const state = item.oauthStates.save.mock.calls[0][0];
    expect(state.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(state.codeVerifierEncrypted).toMatch(/^v1:/);
    expect(decryptString(state.codeVerifierEncrypted)).toHaveLength(86);
    expect(JSON.stringify(item.audit.record.mock.calls)).not.toContain(
      decryptString(state.codeVerifierEncrypted),
    );
  });

  it('consumes OAuth state once and stores a fresh offline grant encrypted when scope is omitted as unchanged', async () => {
    const item = fixture();
    const state: any = {
      id: 'state-1',
      stateHash: 'hash',
      tenantId: 'tenant-1',
      userId: 'user-1',
      codeVerifierEncrypted: encryptString('pkce-verifier'),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    };
    const builder: any = {};
    builder.setLock = jest.fn(() => builder);
    builder.where = jest.fn(() => builder);
    builder.getOne = jest.fn().mockResolvedValue(state);
    const stateRepository = {
      createQueryBuilder: jest.fn(() => builder),
      save: jest.fn(async (value) => value),
    };
    item.dataSource.transaction.mockImplementation(async (callback) =>
      callback({ getRepository: jest.fn(() => stateRepository) }),
    );
    item.google.exchangeCode.mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
    });
    await expect(
      item.service.completeGoogleOAuth('authorization-code', 'opaque-state'),
    ).resolves.toBe(item.connection);
    expect(state.consumedAt).toBeInstanceOf(Date);
    expect(decryptString(item.connection.accessTokenEncrypted)).toBe('new-access-token');
    expect(decryptString(item.connection.refreshTokenEncrypted)).toBe('new-refresh-token');
    expect(item.connection).toMatchObject({
      status: 'configured',
      selectedCalendarId: null,
      grantedScopes: GOOGLE_CALENDAR_SCOPES,
    });
    expect(JSON.stringify(item.audit.record.mock.calls)).not.toContain('new-access-token');
    expect(JSON.stringify(item.audit.record.mock.calls)).not.toContain('new-refresh-token');
  });

  it('reports a selected but untested calendar as unfinished setup', async () => {
    const item = fixture({ status: 'configured' });
    await expect(item.service.status('tenant-1')).resolves.toMatchObject({
      status: 'configured',
      connected: false,
      issue: {
        what: expect.stringMatching(/not been tested/i),
        how: expect.stringMatching(/Test connection/i),
      },
    });
  });

  it('activates and schedules renewal for a validated Google event watch channel', async () => {
    const item = fixture({ status: 'configured', lastTestedAt: null });
    item.google.getCalendar.mockResolvedValue({
      id: 'calendar@example.com',
      summary: 'Appointments',
      accessRole: 'writer',
      timeZone: 'America/New_York',
    });
    await expect(
      item.service.testConnection('tenant-1', 'user-1'),
    ).resolves.toMatchObject({ connected: true });
    expect(item.google.watchEvents).toHaveBeenCalledWith(
      'current-access-token',
      expect.objectContaining({
        calendarId: 'calendar@example.com',
        address: 'https://api.example.com/calendar/google/notifications',
        ttlSeconds: 604_800,
      }),
    );
    const watchToken = item.google.watchEvents.mock.calls[0][1].token;
    expect(item.connection.webhookTokenHash).toBe(
      createHash('sha256').update(watchToken).digest('hex'),
    );
    expect(JSON.stringify(item.connection)).not.toContain(watchToken);
    expect(item.durableJobs.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'calendar.google.renew_watch',
        dedupeKey: 'calendar-google-renew-watch:connection-1',
      }),
    );
  });

  it('validates and deduplicates Google notifications before scheduling reconciliation', async () => {
    const token = 'opaque-channel-token';
    const item = fixture({
      webhookChannelId: 'channel-1',
      webhookResourceId: 'resource-1',
      webhookTokenHash: createHash('sha256').update(token).digest('hex'),
      webhookExpiresAt: new Date(Date.now() + 60_000),
      webhookLastMessageNumber: null,
    });
    const builder: any = {};
    builder.setLock = jest.fn(() => builder);
    builder.where = jest.fn(() => builder);
    builder.getOne = jest.fn().mockResolvedValue(item.connection);
    const repository = {
      createQueryBuilder: jest.fn(() => builder),
      save: jest.fn(async (value) => value),
    };
    item.dataSource.transaction.mockImplementation(async (callback) =>
      callback({ getRepository: jest.fn(() => repository) }),
    );
    item.appointments.find.mockResolvedValue([
      { id: 'appointment-1', tenantId: 'tenant-1' },
    ]);
    const notification = {
      channelId: 'channel-1',
      channelToken: token,
      resourceId: 'resource-1',
      resourceState: 'exists',
      messageNumber: '7',
    };
    await expect(
      item.service.handleGoogleChangeNotification(notification),
    ).resolves.toEqual({ accepted: true, duplicate: false, scheduled: 1 });
    expect(item.durableJobs.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'appointment.reconcile_calendar',
        dedupeKey: 'appointment-calendar-reconcile:appointment-1',
      }),
    );
    item.durableJobs.schedule.mockClear();
    await expect(
      item.service.handleGoogleChangeNotification(notification),
    ).resolves.toEqual({ accepted: true, duplicate: true, scheduled: 0 });
    expect(item.durableJobs.schedule).not.toHaveBeenCalled();
    await expect(
      item.service.handleGoogleChangeNotification({
        ...notification,
        channelToken: 'wrong-token',
        messageNumber: '8',
      }),
    ).rejects.toThrow(/invalid google calendar notification token/i);
  });

  it('rejects OAuth completion without a fresh refresh token to prevent account mixing', async () => {
    const item = fixture();
    const state: any = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      codeVerifierEncrypted: encryptString('pkce-verifier'),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    };
    const builder: any = {
      setLock: jest.fn(),
      where: jest.fn(),
      getOne: jest.fn().mockResolvedValue(state),
    };
    builder.setLock.mockReturnValue(builder);
    builder.where.mockReturnValue(builder);
    item.dataSource.transaction.mockImplementation(async (callback) =>
      callback({
        getRepository: jest.fn(() => ({
          createQueryBuilder: jest.fn(() => builder),
          save: jest.fn(async (value) => value),
        })),
      }),
    );
    item.google.exchangeCode.mockResolvedValue({
      access_token: 'new-access-token',
      scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    });
    await expect(
      item.service.completeGoogleOAuth('authorization-code', 'opaque-state'),
    ).rejects.toThrow(/offline calendar access/i);
    expect(item.google.revokeToken).toHaveBeenCalledWith('new-access-token');
    expect(item.connections.save).not.toHaveBeenCalled();
  });

  it('returns true only after Google confirms the interval is free', async () => {
    const item = fixture();
    const start = new Date('2026-09-01T14:00:00Z');
    const end = new Date('2026-09-01T14:30:00Z');
    await expect(item.service.checkAvailability('tenant-1', start, end)).resolves.toMatchObject({
      available: true,
      timeZone: 'America/New_York',
    });
    item.google.freeBusy.mockResolvedValueOnce([{ start, end }]);
    await expect(item.service.checkAvailability('tenant-1', start, end)).resolves.toMatchObject({
      available: false,
    });
  });

  it('prevents double-booking and never inserts an event when free/busy is occupied', async () => {
    const item = fixture();
    const start = new Date('2026-09-01T14:00:00Z');
    const end = new Date('2026-09-01T14:30:00Z');
    item.google.freeBusy.mockResolvedValue([{ start, end }]);
    await expect(
      item.service.createBookingEvent({
        tenantId: 'tenant-1',
        leadId: 'lead-1',
        start,
        end,
        summary: 'Appointment',
        description: 'Controlled test',
        attendeeEmail: 'lead@example.com',
        idempotencyKey: 'request-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(item.google.insertEvent).not.toHaveBeenCalled();
  });

  it('returns the existing Google event for repeated idempotency keys', async () => {
    const item = fixture();
    item.google.listEvents.mockResolvedValue([
      {
        id: 'event-1',
        etag: 'etag-1',
        status: 'confirmed',
        start: { dateTime: '2026-09-01T14:00:00Z' },
        end: { dateTime: '2026-09-01T14:30:00Z' },
      },
    ]);
    const input = {
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      start: new Date('2026-09-01T14:00:00Z'),
      end: new Date('2026-09-01T14:30:00Z'),
      summary: 'Appointment',
      description: 'Controlled test',
      idempotencyKey: 'request-1',
    };
    await expect(item.service.createBookingEvent(input)).resolves.toMatchObject({ id: 'event-1' });
    await expect(item.service.createBookingEvent(input)).resolves.toMatchObject({ id: 'event-1' });
    expect(item.google.insertEvent).not.toHaveBeenCalled();
    expect(item.google.freeBusy).not.toHaveBeenCalled();
  });

  it('keeps an uncertain create bound to its original calendar after selection changes', async () => {
    const item = fixture({ selectedCalendarId: 'new-calendar@example.com' });
    item.google.getCalendar.mockResolvedValue({
      id: 'original-calendar@example.com',
      accessRole: 'writer',
    });
    item.google.listEvents.mockResolvedValue([
      {
        id: 'event-1',
        status: 'confirmed',
        start: { dateTime: '2026-09-01T14:00:00Z' },
        end: { dateTime: '2026-09-01T14:30:00Z' },
      },
    ]);
    await expect(
      item.service.createBookingEvent({
        tenantId: 'tenant-1',
        calendarId: 'original-calendar@example.com',
        leadId: 'lead-1',
        start: new Date('2026-09-01T14:00:00Z'),
        end: new Date('2026-09-01T14:30:00Z'),
        summary: 'Appointment',
        description: 'Controlled test',
        idempotencyKey: 'request-1',
      }),
    ).resolves.toMatchObject({
      id: 'event-1',
      calendarId: 'original-calendar@example.com',
    });
    expect(item.google.getCalendar).toHaveBeenCalledWith(
      'current-access-token',
      'original-calendar@example.com',
    );
    expect(item.google.listEvents).toHaveBeenCalledWith(
      'current-access-token',
      expect.objectContaining({ calendarId: 'original-calendar@example.com' }),
    );
    expect(item.google.insertEvent).not.toHaveBeenCalled();
  });

  it('recovers an uncertain create by reading the deterministic event id', async () => {
    const item = fixture();
    item.google.insertEvent.mockRejectedValue(
      new GoogleCalendarApiError(
        'GOOGLE_CALENDAR_TIMEOUT',
        'timeout',
        null,
        true,
        true,
      ),
    );
    item.google.getEvent.mockImplementation(async (_token, _calendar, eventId) => ({
      id: 'recovered-event',
      status: 'confirmed',
      start: { dateTime: '2026-09-01T14:00:00Z' },
      end: { dateTime: '2026-09-01T14:30:00Z' },
      extendedProperties: {
        private: {
          rtaIdempotency: item.google.insertEvent.mock.calls[0][1].idempotencyHash,
        },
      },
      requestedEventId: eventId,
    }));
    await expect(
      item.service.createBookingEvent({
        tenantId: 'tenant-1',
        leadId: 'lead-1',
        start: new Date('2026-09-01T14:00:00Z'),
        end: new Date('2026-09-01T14:30:00Z'),
        summary: 'Appointment',
        description: 'Controlled test',
        idempotencyKey: 'request-1',
      }),
    ).resolves.toMatchObject({ id: 'recovered-event' });
    const deterministicId = item.google.insertEvent.mock.calls[0][1].eventId;
    expect(deterministicId).toMatch(/^rta[a-f0-9]{40}$/);
    expect(item.google.getEvent).toHaveBeenCalledWith(
      'current-access-token',
      'calendar@example.com',
      deterministicId,
    );
  });

  it('rejects an uncertain recovered event when its time does not match the booking key', async () => {
    const item = fixture();
    item.google.insertEvent.mockRejectedValue(
      new GoogleCalendarApiError(
        'GOOGLE_CALENDAR_TIMEOUT',
        'timeout',
        null,
        true,
        true,
      ),
    );
    item.google.getEvent.mockImplementation(async () => ({
      id: 'recovered-event',
      status: 'confirmed',
      start: { dateTime: '2026-09-01T15:00:00Z' },
      end: { dateTime: '2026-09-01T15:30:00Z' },
      extendedProperties: {
        private: {
          rtaIdempotency: item.google.insertEvent.mock.calls[0][1].idempotencyHash,
        },
      },
    }));
    await expect(
      item.service.createBookingEvent({
        tenantId: 'tenant-1',
        leadId: 'lead-1',
        start: new Date('2026-09-01T14:00:00Z'),
        end: new Date('2026-09-01T14:30:00Z'),
        summary: 'Appointment',
        description: 'Controlled test',
        idempotencyKey: 'request-1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'APPOINTMENT_IDEMPOTENCY_CONFLICT' }),
    });
  });

  it('refreshes expired access tokens and requires reconnect when refresh is revoked', async () => {
    const item = fixture({ accessTokenExpiresAt: new Date(Date.now() - 1_000) });
    item.google.refreshAccessToken.mockResolvedValue({
      access_token: 'refreshed-access-token',
      expires_in: 3600,
    });
    await expect(
      item.service.checkAvailability(
        'tenant-1',
        new Date('2026-09-01T14:00:00Z'),
        new Date('2026-09-01T14:30:00Z'),
      ),
    ).resolves.toMatchObject({ available: true });
    expect(item.google.freeBusy).toHaveBeenCalledWith(
      'refreshed-access-token',
      expect.any(Object),
    );
    expect(item.connection.accessTokenEncrypted).not.toContain('refreshed-access-token');

    item.connection.accessTokenExpiresAt = new Date(Date.now() - 1_000);
    item.google.refreshAccessToken.mockRejectedValueOnce(
      new GoogleCalendarApiError('GOOGLE_AUTH_REQUIRED', 'revoked', 401, false),
    );
    await expect(
      item.service.checkAvailability(
        'tenant-1',
        new Date('2026-09-02T14:00:00Z'),
        new Date('2026-09-02T14:30:00Z'),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(item.connection.status).toBe('needs_attention');
  });

  it('reschedules and cancels the selected Google event', async () => {
    const item = fixture();
    const start = new Date('2026-09-03T14:00:00Z');
    const end = new Date('2026-09-03T14:30:00Z');
    item.google.freeBusy.mockResolvedValue([{ start, end }]);
    item.google.listEvents.mockResolvedValue([
      {
        id: 'event-1',
        status: 'confirmed',
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      },
    ]);
    item.google.patchEvent.mockResolvedValue({
      id: 'event-1',
      etag: 'etag-2',
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    });
    await expect(
      item.service.updateBookingEvent({
        tenantId: 'tenant-1',
        eventId: 'event-1',
        calendarId: 'original-calendar@example.com',
        etag: 'etag-1',
        start,
        end,
      }),
    ).resolves.toMatchObject({ id: 'event-1', etag: 'etag-2' });
    expect(item.google.freeBusy).toHaveBeenCalledWith(
      'current-access-token',
      expect.objectContaining({ calendarId: 'original-calendar@example.com' }),
    );
    expect(item.google.patchEvent).toHaveBeenCalledWith(
      'current-access-token',
      expect.objectContaining({ calendarId: 'original-calendar@example.com' }),
    );
    await expect(
      item.service.cancelBookingEvent({
        tenantId: 'tenant-1',
        eventId: 'event-1',
        calendarId: 'original-calendar@example.com',
        etag: 'etag-2',
      }),
    ).resolves.toEqual({ cancelled: true });
    expect(item.google.deleteEvent).toHaveBeenCalledWith(
      'current-access-token',
      expect.objectContaining({
        calendarId: 'original-calendar@example.com',
        eventId: 'event-1',
        etag: 'etag-2',
      }),
    );
  });

  it('keeps the provider connected when one event has a stale ETag', async () => {
    const item = fixture();
    const start = new Date('2026-09-03T14:00:00Z');
    const end = new Date('2026-09-03T14:30:00Z');
    item.google.patchEvent.mockRejectedValue(
      new GoogleCalendarApiError(
        'GOOGLE_CALENDAR_CHANGED',
        'The event changed outside RealtyTechAI.',
        412,
        false,
      ),
    );
    await expect(
      item.service.updateBookingEvent({
        tenantId: 'tenant-1',
        eventId: 'event-1',
        calendarId: 'calendar@example.com',
        etag: 'stale-etag',
        start,
        end,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'GOOGLE_CALENDAR_CHANGED' }),
    });
    expect(item.connection.status).toBe('connected');
    expect(item.connections.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'needs_attention' }),
    );

    item.google.freeBusy.mockResolvedValue([]);
    await expect(
      item.service.checkAvailability(
        'tenant-1',
        new Date('2026-09-04T14:00:00Z'),
        new Date('2026-09-04T14:30:00Z'),
      ),
    ).resolves.toMatchObject({ available: true });
  });

  it('does not treat an inaccessible original calendar as a cancelled event after reconnect', async () => {
    const item = fixture();
    item.google.getCalendar.mockRejectedValue(
      new GoogleCalendarApiError(
        'GOOGLE_CALENDAR_REQUEST_FAILED',
        'Calendar is not available to this grant.',
        404,
        false,
      ),
    );
    await expect(
      item.service.getBookingEvent(
        'tenant-1',
        'event-1',
        'original-calendar@example.com',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(item.google.getEvent).not.toHaveBeenCalled();
    expect(item.connection.status).toBe('needs_attention');
  });

  it('fails closed and records an actionable state when Google free/busy is unavailable', async () => {
    const item = fixture();
    item.google.freeBusy.mockRejectedValue(
      new GoogleCalendarApiError(
        'GOOGLE_FREE_BUSY_UNCERTAIN',
        'uncertain',
        503,
        true,
      ),
    );
    await expect(
      item.service.checkAvailability(
        'tenant-1',
        new Date('2026-09-01T14:00:00Z'),
        new Date('2026-09-01T14:30:00Z'),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(item.connection.status).toBe('needs_attention');
    expect(item.operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'calendar_provider_failure' }),
    );
  });
});

describe('CalendarService failure alerting (P3) and credential expiry (P6)', () => {
  function alertFixture(overrides: Record<string, unknown> = {}) {
    const connection: any = {
      id: 'connection-1',
      tenantId: 'tenant-1',
      provider: 'google',
      accessTokenEncrypted: encryptString('current-access-token'),
      refreshTokenEncrypted: encryptString('refresh-token'),
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      refreshTokenExpiresAt: null,
      grantedScopes: [],
      status: 'connected',
      selectedCalendarId: 'calendar@example.com',
      selectedCalendarName: 'Appointments',
      selectedCalendarTimeZone: 'America/New_York',
      lastTestedAt: new Date(),
      lastSuccessfulSyncAt: new Date(),
      lastErrorCode: null,
      lastErrorAt: null,
      webhookChannelId: null,
      webhookResourceId: null,
      webhookTokenHash: null,
      webhookExpiresAt: null,
      webhookLastMessageNumber: null,
    };
    Object.assign(connection, overrides);
    const connections = {
      findOne: jest.fn().mockResolvedValue(connection),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value) => ({ id: 'connection-new', ...value })),
      save: jest.fn(async (value) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const oauthStates = {
      create: jest.fn((value) => ({ id: 'state-1', ...value })),
      save: jest.fn(async (value) => value),
    };
    const google = {
      authorizationUrl: jest.fn().mockReturnValue('https://accounts.google.com/oauth'),
      exchangeCode: jest.fn(),
      refreshAccessToken: jest.fn(),
      revokeToken: jest.fn().mockResolvedValue(undefined),
      listCalendars: jest.fn(),
      getCalendar: jest.fn(),
      freeBusy: jest.fn().mockResolvedValue([]),
      listEvents: jest.fn().mockResolvedValue([]),
      getEvent: jest.fn(),
      insertEvent: jest.fn(),
      patchEvent: jest.fn(),
      deleteEvent: jest.fn(),
      watchEvents: jest.fn().mockImplementation(async (_token, input) => ({
        id: input.channelId,
        resourceId: 'google-resource-1',
        expiration: String(Date.now() + 7 * 24 * 60 * 60_000),
      })),
      stopChannel: jest.fn().mockResolvedValue(undefined),
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
    const appointments = { find: jest.fn().mockResolvedValue([]) };
    const dataSource = {
      transaction: jest.fn(async (callback) =>
        callback({ query: jest.fn(), getRepository: jest.fn() }),
      ),
    };
    const operationalEvents = {
      integrationFailed: jest.fn().mockResolvedValue({ id: 'incident-1' }),
      integrationRecovered: jest.fn().mockResolvedValue({ id: 'incident-1' }),
    };
    const notifications = {
      createForTenant: jest.fn().mockResolvedValue([]),
      createForPlatform: jest.fn().mockResolvedValue([]),
    };
    const tenants = {
      findById: jest.fn().mockResolvedValue({ id: 'tenant-1', name: 'Acme Realty' }),
    };
    const service = new CalendarService(
      dataSource as any,
      connections as any,
      oauthStates as any,
      google as any,
      audit as any,
      operations as any,
      durableJobs as any,
      appointments as any,
      operationalEvents as any,
      notifications as any,
      tenants as any,
    );
    return {
      service,
      connection,
      connections,
      google,
      operationalEvents,
      notifications,
      tenants,
    };
  }

  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'google-client';
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'google-secret';
    process.env.PUBLIC_API_URL = 'https://api.example.com';
  });

  it('notifies tenant owners/admins with a reconnect deep link on OAuth auth failure', async () => {
    const item = alertFixture();
    await (item.service as any).handleProviderError(
      item.connection,
      new GoogleCalendarApiError('GOOGLE_AUTH_REQUIRED', 'revoked', 401, false),
    );
    // Fail-closed state machine is unchanged.
    expect(item.connection.status).toBe('needs_attention');
    expect(item.connection.lastErrorCode).toBe('GOOGLE_AUTH_REQUIRED');
    expect(item.operationalEvents.integrationFailed).toHaveBeenCalledTimes(1);
    expect(item.operationalEvents.integrationFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'Google Calendar',
        tenantId: 'tenant-1',
        tenantName: 'Acme Realty',
        reconnectPath: '/app/settings/calendar',
      }),
    );
  });

  it('stays silent on transient provider errors and non-auth failures', async () => {
    const item = alertFixture();
    await (item.service as any).handleProviderError(
      item.connection,
      new GoogleCalendarApiError(
        'GOOGLE_CALENDAR_TEMPORARY_FAILURE',
        'temporary',
        503,
        true,
      ),
    );
    expect(item.connection.status).toBe('needs_attention');
    expect(item.operationalEvents.integrationFailed).not.toHaveBeenCalled();

    await (item.service as any).handleProviderError(
      item.connection,
      new GoogleCalendarApiError(
        'GOOGLE_CALENDAR_REQUEST_FAILED',
        'not found',
        404,
        false,
      ),
    );
    expect(item.operationalEvents.integrationFailed).not.toHaveBeenCalled();
  });

  it('emits exactly one recovery event when a test reconnect leaves needs_attention', async () => {
    const item = alertFixture({
      status: 'needs_attention',
      lastErrorCode: 'GOOGLE_AUTH_REQUIRED',
      lastErrorAt: new Date(Date.now() - 90 * 60_000),
    });
    item.google.getCalendar.mockResolvedValue({
      accessRole: 'writer',
      summary: 'Appointments',
      timeZone: 'America/New_York',
    });
    await item.service.testConnection('tenant-1', 'user-1');
    expect(item.connection.status).toBe('connected');
    expect(item.operationalEvents.integrationRecovered).toHaveBeenCalledTimes(1);
    expect(item.operationalEvents.integrationRecovered).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'Google Calendar',
        tenantId: 'tenant-1',
        downtimeMinutes: expect.any(Number),
      }),
    );
  });

  it('does not emit recovery when the connection was already healthy', async () => {
    const item = alertFixture({ status: 'connected' });
    item.google.getCalendar.mockResolvedValue({
      accessRole: 'writer',
      summary: 'Appointments',
      timeZone: 'America/New_York',
    });
    await item.service.testConnection('tenant-1', 'user-1');
    expect(item.operationalEvents.integrationRecovered).not.toHaveBeenCalled();
  });

  it('escalates auth-failure needs_attention older than 24h to the platform admin', async () => {
    const now = new Date('2026-09-26T12:00:00Z');
    const staleAt = new Date(now.getTime() - 26 * 60 * 60_000);
    const freshAt = new Date(now.getTime() - 2 * 60 * 60_000);
    const item = alertFixture();
    item.connections.find.mockResolvedValue([
      {
        id: 'conn-stale',
        tenantId: 'tenant-1',
        provider: 'google',
        status: 'needs_attention',
        lastErrorCode: 'GOOGLE_AUTH_REQUIRED',
        lastErrorAt: staleAt,
        refreshTokenExpiresAt: null,
      },
      {
        id: 'conn-fresh',
        tenantId: 'tenant-1',
        provider: 'google',
        status: 'needs_attention',
        lastErrorCode: 'GOOGLE_AUTH_REQUIRED',
        lastErrorAt: freshAt,
        refreshTokenExpiresAt: null,
      },
      {
        id: 'conn-transient',
        tenantId: 'tenant-1',
        provider: 'google',
        status: 'needs_attention',
        lastErrorCode: 'GOOGLE_CALENDAR_TEMPORARY_FAILURE',
        lastErrorAt: new Date(now.getTime() - 30 * 60 * 60_000),
        refreshTokenExpiresAt: null,
      },
    ]);
    const result = await item.service.runConnectionHealthScan(now);
    expect(result.escalated).toBe(1);
    expect(item.notifications.createForPlatform).toHaveBeenCalledTimes(1);
    expect(item.notifications.createForPlatform).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: 'super_admin',
        category: 'system',
        severity: 'warning',
        deduplicationKey: expect.stringContaining(
          `conn-stale:${staleAt.getTime()}`,
        ),
      }),
    );
    expect(item.notifications.createForTenant).not.toHaveBeenCalled();
  });

  it('warns 3 days and 1 day before OAuth refresh-token expiry, once each', async () => {
    const now = new Date('2026-09-26T12:00:00Z');
    const item = alertFixture();
    const expiringSoon = {
      id: 'conn-exp',
      tenantId: 'tenant-1',
      provider: 'google',
      status: 'connected',
      lastErrorCode: null,
      lastErrorAt: null,
      refreshTokenExpiresAt: new Date(now.getTime() + 2.5 * 86_400_000),
    };
    item.connections.find.mockResolvedValue([expiringSoon]);
    const first = await item.service.runConnectionHealthScan(now);
    expect(first.expiryWarnings).toBe(1);
    expect(item.notifications.createForTenant).toHaveBeenCalledTimes(1);
    expect(item.notifications.createForTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        category: 'integrations',
        severity: 'warning',
        actionUrl: '/app/settings/calendar',
        deduplicationKey: expect.stringContaining('calendar:oauth-expiry:3d:conn-exp'),
      }),
    );

    // One day out → the distinct 1-day milestone (different dedupe key).
    item.notifications.createForTenant.mockClear();
    expiringSoon.refreshTokenExpiresAt = new Date(now.getTime() + 20 * 3_600_000);
    const second = await item.service.runConnectionHealthScan(now);
    expect(second.expiryWarnings).toBe(1);
    expect(item.notifications.createForTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        deduplicationKey: expect.stringContaining('calendar:oauth-expiry:1d:conn-exp'),
      }),
    );
  });

  it('does not warn for refresh tokens expiring far in the future or already expired', async () => {
    const now = new Date('2026-09-26T12:00:00Z');
    const item = alertFixture();
    item.connections.find.mockResolvedValue([
      {
        id: 'conn-far',
        tenantId: 'tenant-1',
        provider: 'google',
        status: 'connected',
        refreshTokenExpiresAt: new Date(now.getTime() + 10 * 86_400_000),
      },
      {
        id: 'conn-past',
        tenantId: 'tenant-1',
        provider: 'google',
        status: 'connected',
        refreshTokenExpiresAt: new Date(now.getTime() - 60_000),
      },
      {
        id: 'conn-none',
        tenantId: 'tenant-1',
        provider: 'google',
        status: 'connected',
        refreshTokenExpiresAt: null,
      },
    ]);
    const result = await item.service.runConnectionHealthScan(now);
    expect(result).toEqual({ escalated: 0, expiryWarnings: 0 });
    expect(item.notifications.createForTenant).not.toHaveBeenCalled();
    expect(item.notifications.createForPlatform).not.toHaveBeenCalled();
  });
});
