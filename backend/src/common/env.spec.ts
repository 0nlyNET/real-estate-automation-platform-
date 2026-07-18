import { isPlatformAdminEmail, requireJwtSecret } from './env';

describe('environment security helpers', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('fails closed when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;
    expect(() => requireJwtSecret()).toThrow('JWT_SECRET is required');
  });

  it('requires a strong production JWT secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'too-short';
    expect(() => requireJwtSecret()).toThrow('at least 32 characters');
  });

  it('matches only normalized allow-listed platform administrators', () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'owner@example.com, ADMIN@example.com ';
    expect(isPlatformAdminEmail('admin@example.com')).toBe(true);
    expect(isPlatformAdminEmail('agent@example.com')).toBe(false);
  });
});
