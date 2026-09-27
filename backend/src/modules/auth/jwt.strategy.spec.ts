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
      platformRole: 'super_admin',
      platformOperator: true,
      sessionExpiresAt: null,
    });
  });

  it('revalidates the acting platform admin for an impersonated session', async () => {
    const users = {
      findById: jest.fn(async (id: string) =>
        id === 'target-1'
          ? {
              id,
              email: 'agent@example.com',
              role: 'agent',
              tenantId: 'tenant-1',
              isActive: true,
              isEmailVerified: true,
            }
          : {
              id: 'admin-1',
              email: 'owner@example.com',
              isActive: true,
              isEmailVerified: true,
            },
      ),
    };
    const strategy = new JwtStrategy(users as any);

    await expect(
      strategy.validate({
        sub: 'target-1',
        exp: 2_000_000_000,
        impersonatedBy: { userId: 'admin-1', email: 'stale@example.com' },
      }),
    ).resolves.toMatchObject({
      sub: 'target-1',
      platformAdmin: false,
      impersonatedBy: {
        userId: 'admin-1',
        email: 'owner@example.com',
      },
      sessionExpiresAt: '2033-05-18T03:33:20.000Z',
    });
  });

  it('rejects impersonation after the acting admin loses access', async () => {
    const users = {
      findById: jest.fn(async (id: string) =>
        id === 'target-1'
          ? {
              id,
              email: 'agent@example.com',
              role: 'agent',
              tenantId: 'tenant-1',
              isActive: true,
              isEmailVerified: true,
            }
          : {
              id: 'admin-1',
              email: 'removed@example.com',
              isActive: true,
              isEmailVerified: true,
            },
      ),
    };
    const strategy = new JwtStrategy(users as any);

    await expect(
      strategy.validate({
        sub: 'target-1',
        impersonatedBy: { userId: 'admin-1' },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
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

  it('rejects a token issued before a password reset or logout', async () => {
    const strategy = new JwtStrategy({
      findById: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'agent@example.com',
        tenantId: 'tenant-1',
        isActive: true,
        isEmailVerified: true,
        mustChangePassword: false,
        sessionVersion: 4,
      }),
    } as any);
    await expect(
      strategy.validate({ sub: 'user-1', sessionVersion: 3 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('operator mode', () => {
    const operatorUser = {
      id: 'admin-1',
      email: 'owner@example.com',
      role: 'admin',
      tenantId: 'operator-own-tenant',
      isActive: true,
      isEmailVerified: true,
      mustChangePassword: false,
      sessionVersion: 1,
    };

    it('pins the effective tenant to the explicitly selected tenant, not the operator own tenant', async () => {
      const strategy = new JwtStrategy({
        findById: jest.fn().mockResolvedValue(operatorUser),
      } as any);
      const result = await strategy.validate({
        sub: 'admin-1',
        sessionVersion: 1,
        operatorMode: {
          tenantId: 'tenant-b',
          tenantName: 'Client B',
          startedByUserId: 'admin-1',
          startedByEmail: 'owner@example.com',
          startedAt: '2026-09-27T00:00:00.000Z',
        },
      });
      expect(result.tenantId).toBe('tenant-b');
      expect(result.operatorMode).toEqual({
        tenantId: 'tenant-b',
        tenantName: 'Client B',
        startedByUserId: 'admin-1',
        startedByEmail: 'owner@example.com',
        startedAt: '2026-09-27T00:00:00.000Z',
      });
      // The operator keeps their own identity for audit purposes.
      expect(result.email).toBe('owner@example.com');
      expect(result.platformAdmin).toBe(true);
    });

    it('rejects operator mode when the actor is no longer a platform admin', async () => {
      const strategy = new JwtStrategy({
        findById: jest.fn().mockResolvedValue({
          ...operatorUser,
          email: 'not-an-admin@example.com',
        }),
      } as any);
      await expect(
        strategy.validate({
          sub: 'admin-1',
          sessionVersion: 1,
          operatorMode: { tenantId: 'tenant-b' },
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects operator mode with an empty tenant id', async () => {
      const strategy = new JwtStrategy({
        findById: jest.fn().mockResolvedValue(operatorUser),
      } as any);
      await expect(
        strategy.validate({
          sub: 'admin-1',
          sessionVersion: 1,
          operatorMode: { tenantId: '   ' },
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('does not enter operator mode for normal tenant owners', async () => {
      const strategy = new JwtStrategy({
        findById: jest.fn().mockResolvedValue({
          id: 'user-9',
          email: 'owner-b@example.com',
          role: 'admin',
          tenantId: 'tenant-b',
          isActive: true,
          isEmailVerified: true,
          sessionVersion: 1,
        }),
      } as any);
      const result = await strategy.validate({ sub: 'user-9', sessionVersion: 1 });
      expect(result.tenantId).toBe('tenant-b');
      expect(result.operatorMode).toBeUndefined();
    });
  });
});
