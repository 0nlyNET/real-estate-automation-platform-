import {
  GOOGLE_CALENDAR_SCOPES,
  GoogleCalendarApiError,
  GoogleCalendarClient,
} from './google-calendar.client';

describe('GoogleCalendarClient', () => {
  const originalFetch = global.fetch;
  let client: GoogleCalendarClient;

  beforeEach(() => {
    client = new GoogleCalendarClient();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses offline OAuth, PKCE, state, and only the required calendar scopes', () => {
    const url = new URL(
      client.authorizationUrl({
        clientId: 'client-id',
        redirectUri: 'https://api.example.com/calendar/google/oauth/callback',
        state: 'opaque-state',
        codeChallenge: 'pkce-challenge',
      }),
    );
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toBe('opaque-state');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(
      GOOGLE_CALENDAR_SCOPES,
    );
  });

  it('does not retry an uncertain event insert and sends a deterministic event id', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('socket reset'));
    await expect(
      client.insertEvent('access-token', {
        calendarId: 'primary',
        summary: 'Appointment',
        description: 'Controlled test',
        start: new Date('2026-09-01T14:00:00Z'),
        end: new Date('2026-09-01T14:30:00Z'),
        timeZone: 'America/New_York',
        attendeeEmail: 'lead@example.com',
        idempotencyHash: 'a'.repeat(64),
        eventId: `rta${'a'.repeat(40)}`,
      }),
    ).rejects.toMatchObject({
      code: 'GOOGLE_CALENDAR_TIMEOUT',
      outcomeUncertain: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      id: `rta${'a'.repeat(40)}`,
      attendees: [{ email: 'lead@example.com' }],
      extendedProperties: { private: { rtaIdempotency: 'a'.repeat(64) } },
    });
  });

  it('treats free-busy calendar errors as uncertainty, never as availability', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({ calendars: { primary: { errors: [{ reason: 'backendError' }] } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      client.freeBusy('access-token', {
        calendarId: 'primary',
        start: new Date('2026-09-01T14:00:00Z'),
        end: new Date('2026-09-01T14:30:00Z'),
        timeZone: 'America/New_York',
      }),
    ).rejects.toMatchObject({ code: 'GOOGLE_FREE_BUSY_UNCERTAIN' });
  });

  it('rejects malformed Google busy intervals instead of treating them as free', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          calendars: { primary: { busy: [{ start: 'invalid', end: 'invalid' }] } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      client.freeBusy('access-token', {
        calendarId: 'primary',
        start: new Date('2026-09-01T14:00:00Z'),
        end: new Date('2026-09-01T14:30:00Z'),
        timeZone: 'America/New_York',
      }),
    ).rejects.toMatchObject({ code: 'GOOGLE_FREE_BUSY_UNCERTAIN' });
  });

  it('retries bounded transient reads but reports token-server outages as temporary', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(new Response('temporary', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    await expect(client.listCalendars('access-token')).resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    (global.fetch as jest.Mock).mockReset();
    (global.fetch as jest.Mock).mockResolvedValue(new Response('temporary', { status: 503 }));
    await expect(
      client.refreshAccessToken({
        clientId: 'id',
        clientSecret: 'secret',
        refreshToken: 'refresh',
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<GoogleCalendarApiError>>({
        code: 'GOOGLE_CALENDAR_TEMPORARY_FAILURE',
        transient: true,
      }),
    );
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('retries Google 403 rate-limit responses instead of treating them as revoked access', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    await expect(client.listCalendars('access-token')).resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
