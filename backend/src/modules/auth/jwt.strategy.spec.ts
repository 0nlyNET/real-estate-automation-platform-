import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalAdminEmails = process.env.PLATFORM_ADMIN_EMAILS;

  beforeAll(() => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.PLATFORM_ADMIN_EMAILS = 'owner@example.com';
  });

  afterAll(() => {
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;

    if (originalAdminEmails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = originalAdminEmails;
  });

  it('returns current authorization claims from the database', async () => {
    const users = {
      findById: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'owner@example.com',
        role: 'admin',
        tenantId: 'tenant-2',
        isActive: true,
        isEmailVerified: true,
      }),
    };
    const strategy = new JwtStrategy(users as any);

    await expect(
      strategy.validate({ sub: 'user-1' }),
    ).resolves.toEqual({
      sub: 'user-1',
      email: 'owner@example.com',
      role: 'admin',
      tenantId: 'tenant-2',
      platformAdmin: true,
    });
  });

  it.each([
    ['missing user', null],
    ['inactive user', { id: 'user-1', tenantId: 'tenant-1', isActive: false, isEmailVerified: true }],
    ['unverified user', { id: 'user-1', tenantId: 'tenant-1', isActive: true, isEmailVerified: false }],
    ['user without a tenant', { id: 'user-1', tenantId: null, isActive: true, isEmailVerified: true }],
  ])('rejects a %s', async (_label, user) => {
    const strategy = new JwtStrategy({ findById: jest.fn().mockResolvedValue(user) } as any);
    await expect(strategy.validate({ sub: 'user-1' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token without a subject', async () => {
    const strategy = new JwtStrategy({ findById: jest.fn() } as any);
    await expect(strategy.validate({})).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
