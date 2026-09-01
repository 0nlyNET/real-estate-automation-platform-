import {
  accountSecurityThrottleTracker,
  directIpThrottleTracker,
} from './security-throttle';

describe('security throttle trackers', () => {
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
