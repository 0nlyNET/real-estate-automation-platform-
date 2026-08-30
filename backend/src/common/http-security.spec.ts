import { apiSecurityHeaders, cookieCsrfProtection } from './http-security';

describe('HTTP security middleware', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  function response() {
    const headers = new Map<string, string>();
    const result: any = {
      setHeader: jest.fn((name: string, value: string) =>
        headers.set(name.toLowerCase(), value),
      ),
      status: jest.fn(() => result),
      json: jest.fn(() => result),
      headers,
    };
    return result;
  }

  it('adds restrictive API headers, including HSTS in production', () => {
    process.env.NODE_ENV = 'production';
    const res = response();
    const next = jest.fn();
    apiSecurityHeaders({} as any, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(res.headers.get('strict-transport-security')).toContain(
      'max-age=31536000',
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rejects a cookie-authenticated cross-origin mutation', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    const res = response();
    const next = jest.fn();
    cookieCsrfProtection(
      {
        method: 'POST',
        headers: {
          cookie: 'rtai_session=signed-value',
          origin: 'https://attacker.example',
        },
      } as any,
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('allows the configured origin and does not impose CSRF on bearer APIs', () => {
    process.env.FRONTEND_URL = 'https://app.example.com/';
    const trustedNext = jest.fn();
    cookieCsrfProtection(
      {
        method: 'PATCH',
        headers: {
          cookie: 'rtai_session=signed-value',
          origin: 'https://app.example.com',
        },
      } as any,
      response(),
      trustedNext,
    );
    expect(trustedNext).toHaveBeenCalled();

    const bearerNext = jest.fn();
    cookieCsrfProtection(
      {
        method: 'POST',
        headers: { authorization: 'Bearer value' },
      } as any,
      response(),
      bearerNext,
    );
    expect(bearerNext).toHaveBeenCalled();
  });
});
