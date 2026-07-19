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
        where.some((candidate: any) => candidate.emailVerifyToken === tokenHash)
          ? user
          : null,
      ),
      save: jest.fn(async (value) => value),
    };
    const service = new UsersService(repo as any, {} as any);

    await expect(service.verifyEmail(rawToken)).resolves.toBe(user);
    expect(user.isEmailVerified).toBe(true);
    expect(user.emailVerifyToken).toBeNull();
    expect(user.emailVerifyTokenExpiresAt).toBeNull();
    expect(repo.save).toHaveBeenCalledWith(user);
  });

  it('rejects an expired verification token without activating the user', async () => {
    const user = Object.assign(new User(), {
      id: 'user-1',
      isEmailVerified: false,
      emailVerifyToken: 'legacy-token',
      emailVerifyTokenExpiresAt: new Date(Date.now() - 1),
    });
    const repo = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn(),
    };
    const service = new UsersService(repo as any, {} as any);

    await expect(service.verifyEmail('legacy-token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(user.isEmailVerified).toBe(false);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
