import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
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

describe('AuthService single-use invitations', () => {
  const originalFrontend = process.env.FRONTEND_URL;

  afterEach(() => {
    if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontend;
  });

  function setupInvitation(overrides: Record<string, unknown> = {}) {
    const user: any = {
      id: '00000000-0000-4000-8000-000000000002',
      tenantId: '00000000-0000-4000-8000-000000000001',
      email: 'owner@example.com', role: 'owner', isActive: true,
      isEmailVerified: false, passwordHash: null, mustChangePassword: false,
      sessionVersion: 0, ...((overrides.user as object) || {}),
    };
    const invitation: any = {
      id: '00000000-0000-4000-8000-000000000003',
      tenantId: user.tenantId, userId: user.id, user,
      tokenHash: 'unused-by-mock', expiresAt: new Date(Date.now() + 60_000),
      usedAt: null, revokedAt: null, sentAt: null,
      ...((overrides.invitation as object) || {}),
    };
    const invitationQuery: any = {
      setLock: jest.fn().mockReturnThis(), leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), getOne: jest.fn(async () => invitation),
    };
    const revokeQuery: any = {
      update: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const invitations: any = {
      createQueryBuilder: jest.fn((alias?: string) => alias ? invitationQuery : revokeQuery),
      create: jest.fn((value) => ({ id: '00000000-0000-4000-8000-000000000004', ...value })),
      save: jest.fn(async (value) => value),
    };
    const usersRepo: any = {
      findOne: jest.fn().mockResolvedValue(user), save: jest.fn(async (value) => value),
    };
    const manager: any = {
      getRepository: jest.fn((entity: { name: string }) =>
        entity.name === 'AccountInvitation' ? invitations : usersRepo),
    };
    const dataSource = { transaction: jest.fn(async (callback) => callback(manager)) };
    const users: any = {
      claimWelcomeEmail: jest.fn().mockResolvedValue(null), releaseWelcomeEmail: jest.fn(),
    };
    const jwt = { sign: jest.fn().mockReturnValue('signed-session') };
    const mail = {
      sendAccountInvitation: jest.fn().mockResolvedValue(undefined),
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    };
    const audit = { recordSystemEvent: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      users, jwt as any, {} as any, mail as any, {} as any,
      invitations, dataSource as any, audit as any,
    );
    return { service, user, invitation, invitations, invitationQuery, revokeQuery, usersRepo, mail, audit };
  }

  it('accepts a valid invitation, verifies email, and stores a selected password', async () => {
    const { service, user, invitation, usersRepo, audit } = setupInvitation();
    await expect(service.acceptInvitation('a'.repeat(43), 'Chosen-password-123')).resolves.toMatchObject({
      accessToken: 'signed-session', user: { id: user.id, tenantId: user.tenantId },
    });
    expect(invitation.usedAt).toBeInstanceOf(Date);
    expect(user).toMatchObject({ isEmailVerified: true, mustChangePassword: false, sessionVersion: 1 });
    expect(await bcrypt.compare('Chosen-password-123', user.passwordHash)).toBe(true);
    expect(usersRepo.save).toHaveBeenCalledWith(user);
    expect(audit.recordSystemEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: user.tenantId, eventType: 'account.invitation_accepted', resourceId: user.id,
    }));
  });

  it.each([
    ['expired', { invitation: { expiresAt: new Date(Date.now() - 1) } }],
    ['already used', { invitation: { usedAt: new Date() } }],
    ['wrong tenant', { invitation: { tenantId: '00000000-0000-4000-8000-000000000099' } }],
    ['existing user', { user: { passwordHash: 'existing-password-hash' } }],
  ])('rejects an %s invitation without changing the account', async (_label, overrides) => {
    const { service, user, usersRepo } = setupInvitation(overrides);
    await expect(service.acceptInvitation('b'.repeat(43), 'Chosen-password-123')).rejects.toBeInstanceOf(BadRequestException);
    expect(usersRepo.save).not.toHaveBeenCalled();
    expect(user.isEmailVerified).toBe(false);
  });

  it('rejects duplicate acceptance after the first transaction consumes the token', async () => {
    const { service } = setupInvitation();
    await service.acceptInvitation('c'.repeat(43), 'Chosen-password-123');
    await expect(service.acceptInvitation('c'.repeat(43), 'Another-password-123')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revokes prior links and resends a new hashed invitation without returning its token', async () => {
    process.env.FRONTEND_URL = 'https://www.realtytechai.app';
    const { service, invitations, revokeQuery, mail, audit } = setupInvitation();
    const result = await service.resendInvitation('00000000-0000-4000-8000-000000000001');
    expect(result).toEqual(expect.objectContaining({ ok: true, expiresAt: expect.any(Date) }));
    expect(result).not.toHaveProperty('token');
    expect(revokeQuery.execute).toHaveBeenCalled();
    const created = invitations.create.mock.calls[0][0];
    expect(created.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const link = mail.sendAccountInvitation.mock.calls[0][0].invitationLink;
    expect(link).toMatch(/^https:\/\/www\.realtytechai\.app\/accept-invitation\?token=/);
    expect(link).not.toContain(created.tokenHash);
    expect(audit.recordSystemEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'account.invitation_resent' }));
  });
});
