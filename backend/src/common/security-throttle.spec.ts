import { JwtService } from '@nestjs/jwt';
import { JWT_SIGN_OPTIONS } from '../modules/auth/auth-token';
import {
  accountSecurityThrottleTracker,
  directIpThrottleTracker,
  sessionSecurityThrottleTracker,
} from './security-throttle';

describe('security throttle trackers', () => {
  const originalEnv = { ...process.env };
  const secret = 'test-only-session-throttle-key-not-for-production';
  beforeEach(() => { process.env.JWT_SECRET = secret; });
  afterEach(() => { process.env = { ...originalEnv }; });

  function token(sub: string, options = JWT_SIGN_OPTIONS, key = secret) {
    return new JwtService().sign({ sub }, { secret: key, ...options });
  }

  it('separates verified session subjects behind one frontend peer and binds rotated tokens to the same user', async () => {
    const subject = '00000000-0000-4000-8000-000000000001';
    const request = (value: string) => ({ path: '/auth/session', ip: '192.0.2.10', headers: { cookie: `rtai_session=${value}` } });
    const first = await sessionSecurityThrottleTracker(request(token(subject)));
    const other = await sessionSecurityThrottleTracker(request(token('00000000-0000-4000-8000-000000000002')));
    const rotated = await sessionSecurityThrottleTracker({ path: '/auth/session', ip: '192.0.2.11', headers: { authorization: `Bearer ${token(subject)}` } });
    expect(first).toMatch(/^session-user:[a-f0-9]{64}$/);
    expect(first).not.toContain(subject);
    expect(other).not.toBe(first);
    expect(rotated).toBe(first);
  });

  it.each(['signature', 'issuer', 'audience', 'expired', 'unsigned', 'missing', 'malformed-cookie'])('keeps an invalid %s session in the direct-peer bucket', async (kind) => {
    const options = { ...JWT_SIGN_OPTIONS };
    if (kind === 'issuer') options.issuer = 'wrong-issuer';
    if (kind === 'audience') options.audience = 'wrong-audience';
    const jwt = kind === 'missing' ? '' : kind === 'unsigned' ? 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmb3JnZWQifQ.'
      : kind === 'expired' ? new JwtService().sign({ sub: 'forged-user' }, { secret, ...options, expiresIn: -1 })
      : token('forged-user', options, kind === 'signature' ? 'different-test-signing-key' : secret);
    const tracker = await sessionSecurityThrottleTracker({
      path: '/auth/session', ip: '192.0.2.10', user: { sub: 'forged-user' },
      headers: { cookie: kind === 'malformed-cookie' ? 'rtai_session=%broken' : `rtai_session=${jwt}`, 'x-forwarded-for': '203.0.113.55' },
    });
    expect(tracker).toBe('ip:192.0.2.10');
  });

  it('keeps login and non-session routes keyed to the direct peer even with a valid session', async () => {
    for (const path of ['/auth/login', '/public/inquiry', '/messaging/send']) {
      expect(await sessionSecurityThrottleTracker({ path, ip: '192.0.2.10', headers: { cookie: `rtai_session=${token('signed-user')}` } })).toBe('ip:192.0.2.10');
    }
  });
  it('groups login attempts by normalized account across rotating IPs', async () => {
    const first = await accountSecurityThrottleTracker({
      path: '/auth/login',
      body: { email: ' Owner@Example.COM ' },
      ip: '198.51.100.10',
    });
    const second = await accountSecurityThrottleTracker({
      path: '/auth/login',
      body: { email: 'owner@example.com' },
      ip: '203.0.113.25',
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^account:[a-f0-9]{64}$/);
    expect(first).not.toContain('owner@example.com');
  });

  it('does not trust attacker-supplied forwarding headers for anonymous traffic', async () => {
    const tracker = await accountSecurityThrottleTracker({
      path: '/public/inquiry',
      ip: '192.0.2.10',
      headers: { 'x-forwarded-for': '10.0.0.1, 203.0.113.1' },
    });

    expect(tracker).toBe('ip:192.0.2.10');
  });

  it('uses an opaque authenticated-user tracker when guards already resolved a session', async () => {
    const tracker = await accountSecurityThrottleTracker({
      path: '/messaging/send',
      ip: '192.0.2.10',
      user: { sub: '00000000-0000-4000-8000-000000000001' },
    });

    expect(tracker).toMatch(/^user:[a-f0-9]{64}$/);
    expect(tracker).not.toContain('00000000-0000-4000-8000-000000000001');
  });

  it('retains an independent direct-peer IP key for account endpoints', async () => {
    const first = await directIpThrottleTracker({
      path: '/auth/login',
      ip: '192.0.2.10',
      body: { email: 'victim@example.com' },
    });
    const second = await directIpThrottleTracker({
      path: '/auth/login',
      ip: '192.0.2.11',
      body: { email: 'victim@example.com' },
    });

    expect(first).not.toBe(second);
    expect(first).not.toContain('victim@example.com');
  });
});
