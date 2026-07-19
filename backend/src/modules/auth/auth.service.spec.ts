import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

function resetQueryBuilder(affected = 1) {
  const builder: any = {
    update: jest.fn(() => builder),
    set: jest.fn(() => builder),
    where: jest.fn(() => builder),
    andWhere: jest.fn(() => builder),
    execute: jest.fn().mockResolvedValue({ affected }),
  };
  return builder;
}

describe('AuthService session and account-recovery controls', () => {
  const originalEnvironment = process.env.NODE_ENV;
  const originalFrontend = process.env.FRONTEND_URL;

  afterEach(() => {
    process.env.NODE_ENV = originalEnvironment;
    if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontend;
  });

  function setup(user: any) {
    const users = {
      findByEmail: jest.fn().mockResolvedValue(user),
      findById: jest.fn().mockResolvedValue(user),
      save: jest.fn(async (value) => value),
      verifyEmail: jest.fn().mockResolvedValue(user),
      claimWelcomeEmail: jest.fn().mockResolvedValue(null),
      releaseWelcomeEmail: jest.fn(),
    };
    const resetBuilder = resetQueryBuilder();
    const resets = {
      createQueryBuilder: jest.fn(() => resetBuilder),
      findOne: jest.fn(),
      create: jest.fn((value) => ({ id: 'reset-1', ...value })),
      save: jest.fn(async (value) => value),
    };
    const jwt = { sign: jest.fn().mockReturnValue('signed-session') };
    const mail = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    };
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
    return {
      service: new AuthService(users as any, jwt as any, resets as any, mail as any, operations as any),
      users,
      resets,
      resetBuilder,
      jwt,
      mail,
      operations,
    };
  }

  it('blocks normal login until a temporary password is replaced', async () => {
    const user = {
      id: 'user-1',
      email: 'owner@example.com',
      passwordHash: await bcrypt.hash('Temp-password-123', 4),
      isActive: true,
      isEmailVerified: true,
      mustChangePassword: true,
      sessionVersion: 0,
    };
    const { service, jwt } = setup(user);
    await expect(service.login(user.email, 'Temp-password-123')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('requires the old temporary credential, changes it, and revokes prior sessions', async () => {
    const user = {
      id: 'user-1',
      email: 'owner@example.com',
      passwordHash: await bcrypt.hash('Temp-password-123', 4),
      mustChangePassword: true,
      sessionVersion: 7,
    };
    const { service, users } = setup(user);
    await expect(
      service.changeTemporaryPassword(user.email, 'wrong', 'Private-password-456'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.changeTemporaryPassword(user.email, 'Temp-password-123', 'Private-password-456'),
    ).resolves.toMatchObject({ ok: true });
    expect(user.mustChangePassword).toBe(false);
    expect(user.sessionVersion).toBe(8);
    expect(await bcrypt.compare('Private-password-456', user.passwordHash)).toBe(true);
    expect(users.save).toHaveBeenCalled();
  });

  it('claims a reset token atomically and increments session version', async () => {
    const user = { id: 'user-1', sessionVersion: 2, mustChangePassword: true, passwordHash: 'old' };
    const { service, resets, users } = setup(user);
    resets.findOne.mockResolvedValue({
      id: 'reset-1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
      user,
    });
    await expect(service.resetPassword('raw-token', 'Replacement-password-123')).resolves.toMatchObject({
      ok: true,
    });
    expect(user.sessionVersion).toBe(3);
    expect(user.mustChangePassword).toBe(false);
    expect(users.save).toHaveBeenCalledWith(user);
  });

  it('invalidates prior reset links, stores only a hash, and sends the production link', async () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://app.example.test/';
    const user = { id: 'user-1', email: 'owner@example.test' };
    const { service, resets, resetBuilder, mail } = setup(user);

    const result = await service.requestPasswordReset(' OWNER@example.test ');
    expect(result).toEqual({
      ok: true,
      message: 'If that email exists, a reset link has been created.',
    });
    expect(resetBuilder.execute).toHaveBeenCalled();
    expect(resets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expiresAt: expect.any(Date),
      }),
    );
    const saved = resets.save.mock.calls[0][0];
    const email = mail.sendEmail.mock.calls[0][0];
    expect(email.to).toBe('owner@example.test');
    expect(email.text).toMatch(
      /https:\/\/app\.example\.test\/reset-password\?token=[a-f0-9]{64}/,
    );
    expect(email.text).not.toContain(saved.tokenHash);
  });

  it('sends a welcome email only when the idempotent claim succeeds', async () => {
    const user = { id: 'user-1', email: 'owner@example.com', tenantId: 'tenant-1', isEmailVerified: true };
    const { service, users, mail } = setup(user);
    users.claimWelcomeEmail.mockResolvedValueOnce(null);
    await service.verifyEmail('token-1');
    expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();

    users.claimWelcomeEmail.mockResolvedValueOnce(new Date());
    await service.verifyEmail('token-2');
    expect(mail.sendWelcomeEmail).toHaveBeenCalledTimes(1);
  });
});
