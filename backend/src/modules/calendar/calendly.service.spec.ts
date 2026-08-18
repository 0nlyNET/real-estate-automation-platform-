import { createHash, createHmac } from 'crypto';
import { decryptString, encryptString } from '../../common/crypto-secrets';
import { CALENDLY_SCOPES } from './calendly.client';
import { CalendlyService } from './calendly.service';

describe('CalendlyService', () => {
  const originalEnv = { ...process.env };

  function fixture(overrides: Record<string, unknown> = {}) {
    const callbackToken = 'connection-callback-token';
    const signingKey = 'calendly-signing-key';
    const connection: any = {
      id: 'connection-1',
      tenantId: 'tenant-1',
      provider: 'calendly',
      accessTokenEncrypted: encryptString('access-token'),
      refreshTokenEncrypted: encryptString('refresh-token'),
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      refreshTokenExpiresAt: null,
      grantedScopes: [...CALENDLY_SCOPES],
      providerAccountId: 'user-1',
      providerTenantId: 'organization-1',
      status: 'connected',
      selectedCalendarId: 'event-type-1',
      selectedCalendarName: 'Buyer consultation',
      selectedCalendarTimeZone: 'America/New_York',
      selectedResourceType: 'event_type',
      selectedResourceUri:
        'https://api.calendly.com/event_types/event-type-1',
      selectedResourceMetadata: {
        userUri: 'https://api.calendly.com/users/user-1',
        organizationUri:
          'https://api.calendly.com/organizations/organization-1',
        durationMinutes: 30,
        locations: [{ kind: 'google_conference' }],
      },
      webhookChannelId: 'webhook-1',
      webhookResourceId: 'https://api.calendly.com/users/user-1',
      webhookTokenHash: createHash('sha256')
        .update(callbackToken)
        .digest('hex'),
      webhookSecretEncrypted: encryptString(signingKey),
      webhookExpiresAt: null,
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
    const oauthState: any = {
      id: 'state-1',
      tenantId: 'tenant-1',
      userId: 'actor-1',
      provider: 'calendly',
      codeVerifierEncrypted: encryptString('pkce-verifier'),
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    };
    const stateBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(oauthState),
    };
    const stateRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(stateBuilder),
      save: jest.fn(async (value) => value),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) =>
        callback({ getRepository: jest.fn().mockReturnValue(stateRepository) }),
      ),
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
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const calendly = {
      authorizationUrl: jest.fn(),
      exchangeCode: jest.fn(),
      refreshAccessToken: jest.fn(),
      getCurrentUser: jest.fn(),
      listEventTypes: jest.fn(),
      getEventType: jest.fn(),
      listAvailableTimes: jest.fn(),
      createInvitee: jest.fn(),
      getScheduledEvent: jest.fn(),
      getInvitee: jest.fn(),
      listEventInvitees: jest.fn(),
      findInviteeByTracking: jest.fn(),
      cancelEvent: jest.fn(),
      createWebhookSubscription: jest.fn(),
      deleteWebhookSubscription: jest.fn().mockResolvedValue(undefined),
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
    const service = new CalendlyService(
      dataSource as any,
      connections as any,
      oauthStates as any,
      webhookReceipts as any,
      appointments as any,
      calendly as any,
      audit as any,
      operations as any,
      durableJobs as any,
    );
    return {
      service,
      connection,
      connections,
      oauthState,
      stateBuilder,
      stateRepository,
      webhookReceipts,
      appointments,
      calendly,
      audit,
      operations,
      durableJobs,
      callbackToken,
      signingKey,
    };
  }

  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      'base64',
    );
    process.env.CALENDLY_CLIENT_ID = 'calendly-client';
    process.env.CALENDLY_CLIENT_SECRET = 'calendly-secret';
    process.env.CALENDLY_WEBHOOK_SIGNING_KEY = 'calendly-signing-key';
    process.env.PUBLIC_API_URL = 'https://api.example.com';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('fails closed when disconnected, untested, or missing verified webhook binding', async () => {
    const disconnected = fixture({ status: 'disconnected' });
    await expect(
      disconnected.service.readyBinding('tenant-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CALENDAR_NOT_CONNECTED' }),
    });

    const untested = fixture({ lastTestedAt: null });
    await expect(untested.service.readyBinding('tenant-1')).rejects.toMatchObject(
      {
        response: expect.objectContaining({
          code: 'CALENDAR_NEEDS_ATTENTION',
        }),
      },
    );

    const noCallbackToken = fixture({ webhookTokenHash: null });
    await expect(
      noCallbackToken.service.readyBinding('tenant-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CALENDAR_NEEDS_ATTENTION' }),
    });
  });

  it('uses authoritative event-type availability and confirms the external invitee before returning success', async () => {
    const item = fixture();
    const start = new Date('2027-01-10T14:00:00Z');
    const end = new Date('2027-01-10T14:30:00Z');
    item.calendly.listAvailableTimes.mockResolvedValue([
      {
        status: 'available',
        start_time: start.toISOString(),
        invitees_remaining: 1,
      },
    ]);
    item.calendly.createInvitee.mockResolvedValue({
      uri: 'https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1',
      event: 'https://api.calendly.com/scheduled_events/event-1',
      status: 'active',
      cancel_url: 'https://calendly.com/cancellations/verified',
      reschedule_url: 'https://calendly.com/reschedulings/verified',
      updated_at: '2027-01-01T00:00:00Z',
    });
    item.calendly.getScheduledEvent.mockResolvedValue({
      uri: 'https://api.calendly.com/scheduled_events/event-1',
      status: 'active',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      updated_at: '2027-01-01T00:00:00Z',
      location: {
        join_url: 'https://meet.example.com/verified',
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
      inviteeId: 'invitee-1',
      storedProvider: 'calendly',
      cancelUrl: 'https://calendly.com/cancellations/verified',
      rescheduleUrl: 'https://calendly.com/reschedulings/verified',
    });
    expect(item.calendly.createInvitee).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({
        eventTypeUri:
          'https://api.calendly.com/event_types/event-type-1',
        email: 'lead@example.com',
        trackingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('keeps an uncertain retry bound to its original event type after selection changes', async () => {
    const item = fixture();
    const start = new Date('2027-01-10T14:00:00Z');
    const end = new Date('2027-01-10T14:30:00Z');
    item.calendly.getEventType.mockResolvedValue({
      uri: 'https://api.calendly.com/event_types/original-type',
      duration: 30,
      locations: [{ kind: 'physical', location: 'Office' }],
    });
    item.calendly.listAvailableTimes.mockResolvedValue([
      { status: 'available', start_time: start.toISOString() },
    ]);
    item.calendly.createInvitee.mockResolvedValue({
      uri: 'https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1',
      event: 'https://api.calendly.com/scheduled_events/event-1',
    });
    item.calendly.getScheduledEvent.mockResolvedValue({
      uri: 'https://api.calendly.com/scheduled_events/event-1',
      status: 'active',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
    });
    await item.service.createAppointment({
      tenantId: 'tenant-1',
      resourceId: 'original-type',
      leadId: 'lead-1',
      start,
      end,
      timeZone: 'America/New_York',
      summary: 'Appointment',
      description: 'Controlled test',
      attendeeName: 'Jordan Lead',
      attendeeEmail: 'lead@example.com',
      idempotencyKey: 'appointment-key',
      mode: 'in_person',
    });
    expect(item.calendly.createInvitee).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({
        eventTypeUri:
          'https://api.calendly.com/event_types/original-type',
        location: { kind: 'physical', location: 'Office' },
      }),
    );
  });

  it('recovers a tracked booking before retrying Calendly creation', async () => {
    const item = fixture();
    const start = new Date('2027-01-10T14:00:00Z');
    const end = new Date('2027-01-10T14:30:00Z');
    item.calendly.findInviteeByTracking.mockResolvedValue({
      event: {
        uri: 'https://api.calendly.com/scheduled_events/event-existing',
        status: 'active',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      },
      invitee: {
        uri: 'https://api.calendly.com/scheduled_events/event-existing/invitees/invitee-existing',
        event: 'https://api.calendly.com/scheduled_events/event-existing',
        status: 'active',
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
        idempotencyKey: 'same-uncertain-request',
        mode: 'in_person',
      }),
    ).resolves.toMatchObject({
      id: 'event-existing',
      inviteeId: 'invitee-existing',
    });
    expect(item.calendly.listAvailableTimes).not.toHaveBeenCalled();
    expect(item.calendly.createInvitee).not.toHaveBeenCalled();
  });

  it('rejects meeting types that require invitee-supplied location details', async () => {
    const item = fixture();
    item.calendly.listEventTypes.mockResolvedValue([
      {
        uri: 'https://api.calendly.com/event_types/event-type-1',
        name: 'Choose a location',
        duration: 30,
        locations: [{ kind: 'ask_invitee' }],
      },
    ]);

    await expect(
      item.service.selectResource('tenant-1', 'event-type-1', 'actor-1'),
    ).rejects.toThrow('one host-defined location');
    expect(item.connections.save).not.toHaveBeenCalled();
  });

  it('allows a meeting type with no configured location and omits location when booking', async () => {
    const item = fixture({
      selectedResourceMetadata: {
        userUri: 'https://api.calendly.com/users/user-1',
        organizationUri:
          'https://api.calendly.com/organizations/organization-1',
        durationMinutes: 30,
        locations: [],
      },
    });
    const start = new Date('2027-01-10T14:00:00Z');
    const end = new Date('2027-01-10T14:30:00Z');
    item.calendly.listAvailableTimes.mockResolvedValue([
      { status: 'available', start_time: start.toISOString() },
    ]);
    item.calendly.createInvitee.mockResolvedValue({
      uri: 'https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1',
      event: 'https://api.calendly.com/scheduled_events/event-1',
    });
    item.calendly.getScheduledEvent.mockResolvedValue({
      uri: 'https://api.calendly.com/scheduled_events/event-1',
      status: 'active',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
    });

    await item.service.createAppointment({
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      start,
      end,
      timeZone: 'America/New_York',
      summary: 'Appointment',
      description: 'Controlled test',
      attendeeName: 'Jordan Lead',
      attendeeEmail: 'lead@example.com',
      idempotencyKey: 'appointment-without-location',
      mode: 'phone',
    });
    expect(item.calendly.createInvitee).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ location: null }),
    );
  });

  it('rejects an explicitly incomplete OAuth scope response', async () => {
    const item = fixture();
    item.calendly.exchangeCode.mockResolvedValue({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      scope: 'users:read event_types:read',
    });
    item.calendly.getCurrentUser.mockResolvedValue({
      uri: 'https://api.calendly.com/users/user-1',
      current_organization:
        'https://api.calendly.com/organizations/organization-1',
    });
    await expect(
      item.service.completeOAuth('authorization-code', 'opaque-state'),
    ).rejects.toThrow('permissions were not fully granted');
    expect(item.connections.save).not.toHaveBeenCalled();
    expect(item.stateRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ consumedAt: expect.any(Date) }),
    );
  });

  it('records an omitted OAuth scope response as unknown and still requires endpoint testing before connection', async () => {
    const item = fixture();
    item.calendly.exchangeCode.mockResolvedValue({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 7200,
    });
    item.calendly.getCurrentUser.mockResolvedValue({
      uri: 'https://api.calendly.com/users/user-1',
      current_organization:
        'https://api.calendly.com/organizations/organization-1',
      timezone: 'America/New_York',
    });
    item.connections.findOne.mockResolvedValueOnce(null);
    await expect(
      item.service.completeOAuth('authorization-code', 'opaque-state'),
    ).resolves.toMatchObject({
      status: 'configured',
      grantedScopes: [],
      lastTestedAt: null,
    });
    expect(item.connections.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'configured',
        grantedScopes: [],
        lastTestedAt: null,
      }),
    );
  });

  it('rotates both Calendly tokens atomically', async () => {
    const item = fixture({ accessTokenExpiresAt: new Date(0) });
    item.calendly.refreshAccessToken.mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 7200,
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

  it('requires both a per-connection callback token and a current provider signature', async () => {
    const item = fixture();
    const parsed = {
      event: 'invitee.canceled',
      payload: {
        uri: 'https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1',
        event: 'https://api.calendly.com/scheduled_events/event-1',
        rescheduled: false,
      },
    };
    const raw = Buffer.from(JSON.stringify(parsed));
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = createHmac('sha256', item.signingKey)
      .update(`${timestamp}.`)
      .update(raw)
      .digest('hex');
    item.appointments.findOne.mockResolvedValue({
      id: 'appointment-1',
      tenantId: 'tenant-1',
    });

    await expect(
      item.service.handleWebhook(
        'connection-1',
        'wrong-token',
        raw,
        `t=${timestamp},v1=${signature}`,
        parsed,
      ),
    ).rejects.toThrow('Invalid Calendly webhook callback token');

    await expect(
      item.service.handleWebhook(
        'connection-1',
        item.callbackToken,
        raw,
        `t=${timestamp},v1=${signature}`,
        parsed,
      ),
    ).resolves.toEqual({
      accepted: true,
      duplicate: false,
      scheduled: 1,
    });
    expect(item.durableJobs.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        payload: { appointmentId: 'appointment-1' },
      }),
    );

    item.webhookReceipts.save.mockRejectedValueOnce({ code: '23505' });
    await expect(
      item.service.handleWebhook(
        'connection-1',
        item.callbackToken,
        raw,
        `t=${timestamp},v1=${signature}`,
        parsed,
      ),
    ).resolves.toEqual({ accepted: true, duplicate: true, scheduled: 0 });
  });

  it('never invents API rescheduling and only exposes trusted external URLs', async () => {
    const item = fixture();
    await expect(
      item.service.updateAppointment({} as any),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'CALENDLY_RESCHEDULE_URL_REQUIRED',
      }),
    });
    const external = (item.service as any).external(
      item.connection,
      'event-type-1',
      {
        uri: 'https://api.calendly.com/scheduled_events/event-1',
        location: { join_url: 'javascript:alert(1)' },
      },
      {
        uri: 'https://api.calendly.com/scheduled_events/event-1/invitees/invitee-1',
        event: 'https://api.calendly.com/scheduled_events/event-1',
        cancel_url: 'https://attacker.example/cancel',
        reschedule_url: 'https://calendly.com/reschedulings/verified',
      },
    );
    expect(external).toMatchObject({
      joinUrl: null,
      cancelUrl: null,
      rescheduleUrl: 'https://calendly.com/reschedulings/verified',
    });
  });
});
