import { CalendarOAuthState } from '../calendar/calendar-oauth-state.entity';
import { Credential } from '../settings/credential.entity';
import { IntegrationsService } from './integrations.service';

describe('Facebook OAuth state and credential exchange', () => {
  const originalEnvironment = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...originalEnvironment };
    global.fetch = originalFetch;
  });

  function harness() {
    const credentials: Credential[] = [];
    const states: CalendarOAuthState[] = [];
    const credentialRepository = {
      findOne: jest.fn(async ({ where }: any) =>
        credentials.find(
          (row) =>
            row.provider === where.provider &&
            row.tenant.id === where.tenant.id,
        ) || null,
      ),
      create: jest.fn((value) => Object.assign(new Credential(), value)),
      save: jest.fn(async (value: Credential) => {
        if (!credentials.includes(value)) credentials.push(value);
        return value;
      }),
    };
    const oauthRepository = {
      create: jest.fn((value) => Object.assign(new CalendarOAuthState(), value)),
      save: jest.fn(async (value: CalendarOAuthState) => {
        if (!states.includes(value)) states.push(value);
        return value;
      }),
    };
    const managerRepository = {
      createQueryBuilder: jest.fn(() => {
        const builder: any = {
          setLock: jest.fn(() => builder),
          where: jest.fn((_sql: string, params: any) => {
            builder.params = params;
            return builder;
          }),
          getOne: jest.fn(async () =>
            states.find(
              (row) =>
                row.stateHash === builder.params.stateHash &&
                row.provider === builder.params.provider,
            ) || null,
          ),
        };
        return builder;
      }),
      save: jest.fn(async (value) => value),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) =>
        callback({
          getRepository: (entity: unknown) => {
            expect(entity).toBe(CalendarOAuthState);
            return managerRepository;
          },
        }),
      ),
    };
    const service = new IntegrationsService(
      credentialRepository as any,
      { createTask: jest.fn() } as any,
      undefined,
      undefined,
      undefined,
      oauthRepository as any,
      dataSource as any,
    );
    return { service, states };
  }

  it('uses opaque single-use state and keeps the app secret out of the token URL', async () => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString('base64');
    process.env.FACEBOOK_APP_ID = 'facebook-app-id';
    process.env.FACEBOOK_APP_SECRET = 'facebook-app-secret-value';
    process.env.FACEBOOK_REDIRECT_URL =
      'https://api.example.test/integrations/facebook/callback';
    const { service, states } = harness();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'provider-access-token' }),
    }) as any;

    const started = await service.facebookOAuthStart(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    );
    const state = new URL(started.url).searchParams.get('state') || '';
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(state).not.toContain('00000000-0000-4000-8000-000000000001');
    expect(states[0]).toMatchObject({
      tenantId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      provider: 'facebook',
      consumedAt: null,
    });

    await expect(
      service.facebookOAuthCallback('authorization-code', state),
    ).resolves.toEqual({ ok: true });
    expect(states[0].consumedAt).toBeInstanceOf(Date);
    const [tokenUrl, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(tokenUrl)).toBe(
      'https://graph.facebook.com/v19.0/oauth/access_token',
    );
    expect(String(tokenUrl)).not.toContain('facebook-app-secret-value');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(String(options.body)).toContain(
      'client_secret=facebook-app-secret-value',
    );

    await expect(
      service.facebookOAuthCallback('authorization-code', state),
    ).resolves.toEqual({
      ok: false,
      error: 'Facebook state mismatch. Please retry connect.',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
