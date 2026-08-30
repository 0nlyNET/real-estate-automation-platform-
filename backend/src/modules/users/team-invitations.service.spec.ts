import { ServiceUnavailableException } from '@nestjs/common';
import { TeamInvitationsService } from './team-invitations.service';
import { User } from './user.entity';
import { Team } from '../teams/team.entity';
import { AccountInvitation } from '../auth/account-invitation.entity';

describe('TeamInvitationsService secure invitation workflow', () => {
  function setup(mailFailure = false) {
    const user = {
      id: '00000000-0000-4000-8000-000000000010',
      email: 'agent@example.com',
      role: 'agent',
      teamId: '00000000-0000-4000-8000-000000000020',
      isActive: true,
    };
    const invitation: any = {
      id: '00000000-0000-4000-8000-000000000030',
      expiresAt: new Date(Date.now() + 60_000),
      sentAt: null,
    };
    const users = {
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(user),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const teams = {
      findOne: jest.fn().mockResolvedValue({ id: user.teamId }),
    };
    const invitations = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...invitation, ...value })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const manager = {
      query: jest.fn(),
      getRepository: jest.fn((entity) => {
        if (entity === User) return users;
        if (entity === Team) return teams;
        if (entity === AccountInvitation) return invitations;
        throw new Error('Unexpected repository');
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (callback) => callback(manager)),
      getRepository: jest.fn((entity) => manager.getRepository(entity)),
    };
    const mail = {
      sendAccountInvitation: mailFailure
        ? jest.fn().mockRejectedValue(new Error('provider rejected request'))
        : jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new TeamInvitationsService(dataSource as any, mail as any),
      user,
      users,
      invitations,
      mail,
    };
  }

  const tenant: any = {
    id: '00000000-0000-4000-8000-000000000001',
  };

  it('returns only non-secret invitation metadata', async () => {
    const { service, invitations, mail } = setup();
    const result = await service.create({
      tenant,
      email: 'agent@example.com',
      role: 'agent',
      teamId: '00000000-0000-4000-8000-000000000020',
    });
    expect(result).toMatchObject({
      email: 'agent@example.com',
      invitationEmailSent: true,
    });
    expect(result).not.toHaveProperty('tempPassword');
    expect(result).not.toHaveProperty('verifyLink');
    expect(result).not.toHaveProperty('token');
    const persisted = invitations.create.mock.calls[0][0];
    expect(persisted.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const sentLink = mail.sendAccountInvitation.mock.calls[0][0].invitationLink;
    expect(sentLink).toContain('/accept-invitation?token=');
    expect(JSON.stringify(result)).not.toContain(sentLink);
  });

  it('revokes the token and removes the pending account if delivery fails', async () => {
    const { service, invitations, users } = setup(true);
    await expect(
      service.create({
        tenant,
        email: 'agent@example.com',
        role: 'agent',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(invitations.delete).toHaveBeenCalled();
    expect(users.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenant.id,
      }),
    );
  });
});
