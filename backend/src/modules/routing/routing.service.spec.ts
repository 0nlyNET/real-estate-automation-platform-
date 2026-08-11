import { RoutingService } from './routing.service';

describe('RoutingService tenant/team round robin', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001';
  const teamId = '00000000-0000-4000-8000-000000000010';
  const lead = (id: string) => ({ id, tenantId, source: 'website', stage: 'new' } as any);

  it('rotates deterministically through active users in the selected tenant team', async () => {
    const rule: any = {
      id: '00000000-0000-4000-8000-000000000020', tenantId, isActive: true,
      priority: 1, conditions: {}, actionType: 'round_robin_team', actionConfig: { teamId },
    };
    const rules: any = { find: jest.fn().mockResolvedValue([rule]) };
    const logs: any = {
      findOne: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ assignedToUserId: '00000000-0000-4000-8000-000000000101' }),
      create: jest.fn((value) => value), save: jest.fn(async (value) => value),
    };
    const users: any = {
      find: jest.fn().mockResolvedValue([
        { id: '00000000-0000-4000-8000-000000000102', tenantId, teamId, isActive: true, role: 'agent', email: 'b@example.com' },
        { id: '00000000-0000-4000-8000-000000000101', tenantId, teamId, isActive: true, role: 'agent', email: 'a@example.com' },
      ]),
    };
    const teams: any = { findOne: jest.fn().mockResolvedValue({ id: teamId, tenantId }) };
    const service = new RoutingService(rules, logs, users, teams, { getOnlineUserIds: jest.fn() } as any);
    await expect(service.routeLead(lead('00000000-0000-4000-8000-000000000201'))).resolves.toMatchObject({
      assignedToUserId: '00000000-0000-4000-8000-000000000101', assignedToTeamId: teamId,
    });
    await expect(service.routeLead(lead('00000000-0000-4000-8000-000000000202'))).resolves.toMatchObject({
      assignedToUserId: '00000000-0000-4000-8000-000000000102', assignedToTeamId: teamId,
    });
    expect(users.find).toHaveBeenCalledWith({ where: { tenantId, teamId, isActive: true } });
  });

  it('skips a fixed user that is disabled or belongs to another tenant', async () => {
    const rule: any = {
      id: '00000000-0000-4000-8000-000000000020', tenantId, isActive: true,
      priority: 1, conditions: {}, actionType: 'fixed_user',
      actionConfig: { userId: '00000000-0000-4000-8000-000000000099' },
    };
    const users: any = { findOne: jest.fn().mockResolvedValue(null) };
    const logs: any = {
      create: jest.fn((value) => value), save: jest.fn(async (value) => value),
    };
    const service = new RoutingService(
      { find: jest.fn().mockResolvedValue([rule]) } as any,
      logs,
      users,
      {} as any,
      {} as any,
    );
    await expect(service.routeLead(lead('00000000-0000-4000-8000-000000000201'))).resolves.toBeNull();
    expect(users.findOne).toHaveBeenCalledWith({ where: {
      id: rule.actionConfig.userId, tenantId, isActive: true,
    } });
    expect(logs.save).toHaveBeenCalledWith(expect.objectContaining({ decision: 'no_matching_rule' }));
  });

  it('never uses a team from another tenant', async () => {
    const rule: any = {
      id: '00000000-0000-4000-8000-000000000020', tenantId, isActive: true,
      priority: 1, conditions: {}, actionType: 'round_robin_team', actionConfig: { teamId },
    };
    const teams: any = { findOne: jest.fn().mockResolvedValue(null) };
    const users: any = { find: jest.fn() };
    const logs: any = { create: jest.fn((value) => value), save: jest.fn(async (value) => value) };
    const service = new RoutingService(
      { find: jest.fn().mockResolvedValue([rule]) } as any,
      logs,
      users,
      teams,
      {} as any,
    );
    await expect(service.routeLead(lead('00000000-0000-4000-8000-000000000201'))).resolves.toBeNull();
    expect(teams.findOne).toHaveBeenCalledWith({ where: { id: teamId, tenantId } });
    expect(users.find).not.toHaveBeenCalled();
  });
});
