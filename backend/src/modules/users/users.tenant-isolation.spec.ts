import { BadRequestException } from '@nestjs/common';
import { Team } from '../teams/team.entity';
import { TeamsService } from '../teams/teams.service';
import { User } from './user.entity';
import { UsersService } from './users.service';

describe('team and user tenant isolation', () => {
  const tenantA = '00000000-0000-4000-8000-00000000000a';
  const tenantB = '00000000-0000-4000-8000-00000000000b';

  it('does not enumerate, rename, or delete another tenant team', async () => {
    const teams = [
      Object.assign(new Team(), { id: 'team-a', tenantId: tenantA, name: 'A team' }),
      Object.assign(new Team(), { id: 'team-b', tenantId: tenantB, name: 'B team' }),
    ];
    const repo = {
      find: jest.fn(async ({ where }: any) =>
        teams.filter((team) => team.tenantId === where.tenantId),
      ),
      findOne: jest.fn(async ({ where }: any) =>
        teams.find(
          (team) => team.id === where.id && team.tenantId === where.tenantId,
        ) || null,
      ),
      save: jest.fn(async (value) => value),
      remove: jest.fn(async (value) => value),
    };
    const service = new TeamsService(repo as any);

    await expect(service.list(tenantA)).resolves.toEqual([teams[0]]);
    await expect(service.rename(tenantA, 'team-b', 'Stolen')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.remove(tenantA, 'team-b')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('does not enumerate or modify another tenant user or assign its team', async () => {
    const users = [
      Object.assign(new User(), {
        id: 'user-a',
        tenantId: tenantA,
        email: 'a@example.test',
        role: 'owner',
        isActive: true,
      }),
      Object.assign(new User(), {
        id: 'user-b',
        tenantId: tenantB,
        email: 'b@example.test',
        role: 'agent',
        isActive: true,
      }),
    ];
    const userRepo = {
      find: jest.fn(async ({ where }: any) =>
        users.filter((user) => user.tenantId === where.tenant.id),
      ),
      findOne: jest.fn(async ({ where }: any) =>
        users.find(
          (user) =>
            (!where.id || user.id === where.id) &&
            (!where.tenantId || user.tenantId === where.tenantId),
        ) || null,
      ),
      save: jest.fn(async (value) => value),
    };
    const teamRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        where.id === 'team-b' && where.tenantId === tenantB
          ? { id: 'team-b', tenantId: tenantB }
          : null,
      ),
    };
    const service = new UsersService(userRepo as any, teamRepo as any);

    await expect(service.listByTenant(tenantA)).resolves.toEqual([users[0]]);
    await expect(
      service.updateRole(tenantA, 'user-b', 'admin', {
        userId: 'user-a',
        role: 'owner',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.setActive(tenantA, 'user-b', false, {
        userId: 'user-a',
        role: 'owner',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateTeam(tenantA, 'user-a', 'team-b', {
        userId: 'user-a',
        role: 'owner',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userRepo.save).not.toHaveBeenCalled();
    expect(teamRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'team-b', tenantId: tenantA },
    });
  });
});
