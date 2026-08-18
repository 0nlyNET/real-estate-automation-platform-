import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
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
    };
    const audit = {
      record: jest.fn().mockResolvedValue({}),
      recordSystemEvent: jest.fn().mockResolvedValue({}),
    };
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
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
    );
    return {
      service,
      connection,
      connections,
      oauthStates,
      google,
      audit,
      operations,
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
    item.google.patchEvent.mockResolvedValue({ id: 'event-1', etag: 'etag-2' });
    await expect(
      item.service.updateBookingEvent({
        tenantId: 'tenant-1',
        eventId: 'event-1',
        calendarId: 'original-calendar@example.com',
        etag: 'etag-1',
        start,
        end,
        summary: 'Rescheduled appointment',
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
