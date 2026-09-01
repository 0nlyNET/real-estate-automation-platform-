import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { User } from './user.entity';
import { UsersService } from './users.service';

describe('UsersService email verification', () => {
  it('accepts the hashed one-time token and clears verification material', async () => {
    const rawToken = 'verification-token-controlled-by-test';
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const user = Object.assign(new User(), {
      id: 'user-1',
      email: 'owner@example.test',
      isEmailVerified: false,
      emailVerifyToken: tokenHash,
      emailVerifyTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    const repo = {
      findOne: jest.fn(async ({ where }: any) =>
        where.emailVerifyToken === tokenHash ? user : null,
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const service = new UsersService(repo as any, {} as any);

    await expect(service.verifyEmail(rawToken)).resolves.toBe(user);
    expect(user.isEmailVerified).toBe(true);
    expect(user.emailVerifyToken).toBeNull();
    expect(user.emailVerifyTokenExpiresAt).toBeNull();
    expect(repo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: user.id, emailVerifyToken: tokenHash }),
      {
        isEmailVerified: true,
        emailVerifyToken: null,
        emailVerifyTokenExpiresAt: null,
      },
    );
  });

  it('rejects an expired verification token without activating the user', async () => {
    const rawToken = 'expired-token';
    const user = Object.assign(new User(), {
      id: 'user-1',
      isEmailVerified: false,
      emailVerifyToken: crypto.createHash('sha256').update(rawToken).digest('hex'),
      emailVerifyTokenExpiresAt: new Date(Date.now() - 1),
    });
    const repo = {
      findOne: jest.fn().mockResolvedValue(user),
      update: jest.fn(),
    };
    const service = new UsersService(repo as any, {} as any);

    await expect(service.verifyEmail(rawToken)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(user.isEmailVerified).toBe(false);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects a concurrent replay when another request already claimed the token', async () => {
    const rawToken = 'verification-token-replayed';
    const user = Object.assign(new User(), {
      id: 'user-1',
      isEmailVerified: false,
      emailVerifyToken: crypto.createHash('sha256').update(rawToken).digest('hex'),
      emailVerifyTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    const repo = {
      findOne: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const service = new UsersService(repo as any, {} as any);

    await expect(service.verifyEmail(rawToken)).rejects.toThrow(
      'Token already used or expired',
    );
    expect(user.isEmailVerified).toBe(false);
  });

  it('rejects legacy verification material without an expiration', async () => {
    const rawToken = 'verification-token-without-expiry';
    const user = Object.assign(new User(), {
      id: 'user-1',
      isEmailVerified: false,
      emailVerifyToken: crypto.createHash('sha256').update(rawToken).digest('hex'),
      emailVerifyTokenExpiresAt: null,
    });
    const repo = {
      findOne: jest.fn().mockResolvedValue(user),
      update: jest.fn(),
    };
    const service = new UsersService(repo as any, {} as any);

    await expect(service.verifyEmail(rawToken)).rejects.toThrow('Token expired');
    expect(repo.update).not.toHaveBeenCalled();
  });
});
