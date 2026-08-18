import {
  MICROSOFT_CALENDAR_SCOPES,
  MicrosoftCalendarClient,
} from './microsoft-calendar.client';

describe('MicrosoftCalendarClient', () => {
  const originalFetch = global.fetch;
  let client: MicrosoftCalendarClient;

  beforeEach(() => {
    client = new MicrosoftCalendarClient();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses organizational OAuth, PKCE, one-time state, and delegated calendar scopes', () => {
    const url = new URL(
      client.authorizationUrl({
        clientId: 'client-id',
        redirectUri:
          'https://api.example.com/calendar/microsoft/oauth/callback',
        state: 'opaque-state',
        codeChallenge: 'pkce-challenge',
      }),
    );
    expect(url.origin).toBe('https://login.microsoftonline.com');
    expect(url.pathname).toContain('/organizations/oauth2/v2.0/authorize');
    expect(url.searchParams.get('state')).toBe('opaque-state');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(
      MICROSOFT_CALENDAR_SCOPES,
    );
  });

  it('uses getSchedule and fails closed when Microsoft returns no authoritative schedule', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    await expect(
      client.getSchedule('access-token', {
        address: 'agent@example.com',
        start: new Date('2026-09-01T14:00:00Z'),
        end: new Date('2026-09-01T14:30:00Z'),
        timeZone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'MICROSOFT_FREE_BUSY_UNCERTAIN' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(
      'https://graph.microsoft.com/v1.0/me/calendar/getSchedule',
    );
    expect(JSON.parse(String(init.body))).toMatchObject({
      schedules: ['agent@example.com'],
      availabilityViewInterval: 5,
    });
  });

  it('creates a Teams event with an attendee and deterministic transaction ID without retrying uncertainty', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('socket reset'));
    await expect(
      client.createEvent('access-token', {
        calendarId: 'calendar-1',
        subject: 'Appointment',
        description: 'Controlled test',
        start: new Date('2026-09-01T14:00:00Z'),
        end: new Date('2026-09-01T14:30:00Z'),
        attendeeEmail: 'lead@example.com',
        attendeeName: 'Jordan Lead',
        transactionId: 'deterministic-transaction',
        virtual: true,
      }),
    ).rejects.toMatchObject({
      code: 'MICROSOFT_TEMPORARY_FAILURE',
      outcomeUncertain: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      transactionId: 'deterministic-transaction',
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
      attendees: [
        {
          type: 'required',
          emailAddress: {
            address: 'lead@example.com',
            name: 'Jordan Lead',
          },
        },
      ],
    });
  });

  it('patches only event timing with If-Match so Teams and attendees are preserved', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'event-1',
          '@odata.etag': 'etag-2',
          start: { dateTime: '2026-09-01T15:00:00Z' },
          end: { dateTime: '2026-09-01T16:00:00Z' },
          onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/1' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await client.patchEvent('access-token', {
      calendarId: 'calendar-1',
      eventId: 'event-1',
      version: 'etag-1',
      start: new Date('2026-09-01T15:00:00Z'),
      end: new Date('2026-09-01T16:00:00Z'),
    });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(new Headers(init.headers).get('If-Match')).toBe('etag-1');
    expect(JSON.parse(String(init.body))).toEqual({
      start: { dateTime: '2026-09-01T15:00:00.000Z', timeZone: 'UTC' },
      end: { dateTime: '2026-09-01T16:00:00.000Z', timeZone: 'UTC' },
    });
  });

  it('creates expiring event subscriptions with lifecycle recovery and opaque client state', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'subscription-1',
          resource: 'users/account-1/events',
          expirationDateTime: '2026-09-07T00:00:00Z',
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );
    await client.createSubscription('access-token', {
      accountId: 'account-1',
      notificationUrl:
        'https://api.example.com/calendar/microsoft/notifications',
      lifecycleNotificationUrl:
        'https://api.example.com/calendar/microsoft/notifications',
      clientState: 'opaque-client-state',
      expiration: new Date('2026-09-07T00:00:00Z'),
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://graph.microsoft.com/v1.0/subscriptions');
    expect(JSON.parse(String(init.body))).toMatchObject({
      changeType: 'created,updated,deleted',
      resource: 'users/account-1/events',
      clientState: 'opaque-client-state',
      latestSupportedTlsVersion: 'v1_2',
    });
  });

  it('rejects provider pagination that leaves the Microsoft Graph origin', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          value: [],
          '@odata.nextLink': 'https://attacker.example/steal',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(client.listCalendars('access-token')).rejects.toThrow(
      'unsafe URL',
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
