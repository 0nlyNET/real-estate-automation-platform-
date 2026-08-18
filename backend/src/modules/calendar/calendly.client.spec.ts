import { CALENDLY_SCOPES, CalendlyClient } from './calendly.client';

describe('CalendlyClient', () => {
  const originalFetch = global.fetch;
  let client: CalendlyClient;

  beforeEach(() => {
    client = new CalendlyClient();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses OAuth PKCE, one-time state, and the required scheduling scopes', () => {
    const url = new URL(
      client.authorizationUrl({
        clientId: 'client-id',
        redirectUri: 'https://api.example.com/calendar/calendly/oauth/callback',
        state: 'opaque-state',
        codeChallenge: 'pkce-challenge',
      }),
    );
    expect(url.origin).toBe('https://auth.calendly.com');
    expect(url.searchParams.get('state')).toBe('opaque-state');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(
      CALENDLY_SCOPES,
    );
  });

  it('rotates a refresh token with server-side basic authentication', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          scope: CALENDLY_SCOPES.join(' '),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await client.refreshAccessToken({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      refreshToken: 'old-refresh',
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://auth.calendly.com/oauth/token');
    expect(new Headers(init.headers).get('Authorization')).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
    );
    expect(String(init.body)).toContain('grant_type=refresh_token');
    expect(String(init.body)).toContain('refresh_token=old-refresh');
  });

  it('creates a real invitee with deterministic tracking and does not retry an uncertain mutation', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('socket reset'));
    await expect(
      client.createInvitee('access-token', {
        eventTypeUri: 'https://api.calendly.com/event_types/type-1',
        start: new Date('2026-09-01T14:00:00Z'),
        name: 'Jordan Lead',
        email: 'lead@example.com',
        timeZone: 'America/New_York',
        trackingFingerprint: 'deterministic-fingerprint',
        location: { kind: 'google_conference' },
      }),
    ).rejects.toMatchObject({
      code: 'CALENDLY_TEMPORARY_FAILURE',
      outcomeUncertain: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.calendly.com/invitees');
    expect(JSON.parse(String(init.body))).toMatchObject({
      event_type: 'https://api.calendly.com/event_types/type-1',
      start_time: '2026-09-01T14:00:00.000Z',
      invitee: {
        name: 'Jordan Lead',
        email: 'lead@example.com',
        timezone: 'America/New_York',
      },
      tracking: {
        utm_source: 'realtytechai',
        utm_campaign: 'direct_booking',
        utm_content: 'deterministic-fingerprint',
      },
    });
  });

  it('queries Calendly availability rather than recreating scheduling rules', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          collection: [
            {
              status: 'available',
              start_time: '2026-09-01T14:00:00Z',
              invitees_remaining: 1,
            },
          ],
          pagination: { next_page: null },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      client.listAvailableTimes('access-token', {
        eventTypeUri: 'https://api.calendly.com/event_types/type-1',
        start: new Date('2026-09-01T13:59:00Z'),
        end: new Date('2026-09-02T14:00:00Z'),
      }),
    ).resolves.toHaveLength(1);
    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url.pathname).toBe('/event_type_available_times');
    expect(url.searchParams.get('event_type')).toBe(
      'https://api.calendly.com/event_types/type-1',
    );
  });

  it('subscribes to actual invitee created/cancelled semantics', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          resource: {
            uri: 'https://api.calendly.com/webhook_subscriptions/hook-1',
            state: 'active',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );
    await client.createWebhookSubscription('access-token', {
      callbackUrl:
        'https://api.example.com/calendar/calendly/notifications?connection=1&token=opaque',
      organizationUri: 'https://api.calendly.com/organizations/org-1',
      userUri: 'https://api.calendly.com/users/user-1',
    });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(String(init.body))).toEqual({
      url: 'https://api.example.com/calendar/calendly/notifications?connection=1&token=opaque',
      events: ['invitee.created', 'invitee.canceled'],
      organization: 'https://api.calendly.com/organizations/org-1',
      user: 'https://api.calendly.com/users/user-1',
      scope: 'user',
    });
  });

  it('rejects Calendly pagination that leaves the provider origin', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify({
          collection: [],
          pagination: { next_page: 'https://attacker.example/steal' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(
      client.listEventTypes(
        'access-token',
        'https://api.calendly.com/users/user-1',
      ),
    ).rejects.toThrow('unsafe URL');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
