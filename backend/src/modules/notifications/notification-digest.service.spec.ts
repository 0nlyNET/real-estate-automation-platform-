import { NotificationDigestService } from './notification-digest.service';

describe('notification digests', () => {
  const PLATFORM_ADMINS = 'a-owner@example.com,b-owner@example.com';
  const savedAdmins = process.env.PLATFORM_ADMIN_EMAILS;
  beforeAll(() => {
    process.env.PLATFORM_ADMIN_EMAILS = PLATFORM_ADMINS;
  });
  afterAll(() => {
    if (savedAdmins === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
    else process.env.PLATFORM_ADMIN_EMAILS = savedAdmins;
  });

  function setup() {
    const notifications = {
      createForPlatform: jest.fn(async (..._args: any[]) => []),
      createForTenant: jest.fn(async (..._args: any[]) => [{ id: 'digest-1' }]),
      getPreferences: jest.fn(async (userId: string) => ({
        dailyDigestEnabled: userId !== 'user-owner-2',
        weeklyDigestEnabled: false,
        emailEnabled: true,
      })),
    };
    const users = {
      find: jest.fn(async ({ where }: any) => {
        const all = [
          { id: 'user-owner-1', tenantId: 'tenant-1', role: 'owner', email: 'a-owner@example.com', isActive: true, isEmailVerified: true },
          { id: 'user-agent-1', tenantId: 'tenant-1', role: 'agent', email: 'a-agent@example.com', isActive: true, isEmailVerified: true },
          { id: 'user-owner-2', tenantId: 'tenant-2', role: 'owner', email: 'b-owner@example.com', isActive: true, isEmailVerified: true },
          { id: 'user-owner-2b', tenantId: 'tenant-2', role: 'owner', email: 'b-owner2@example.com', isActive: true, isEmailVerified: true },
        ];
        if (where?.tenantId) return all.filter((u) => u.tenantId === where.tenantId);
        return all;
      }),
    };
    const adminNotifications = {
      count: jest.fn(async () => 2),
      find: jest.fn(async () => []),
      createQueryBuilder: jest.fn(() => {
        const builder: any = {
          andWhere: jest.fn(() => builder),
          select: jest.fn(() => builder),
          addSelect: jest.fn(() => builder),
          groupBy: jest.fn(() => builder),
          getRawMany: jest.fn(async () => [
            { severity: 'warning', count: '2' },
            { severity: 'info', count: '5' },
          ]),
        };
        return builder;
      }),
    };
    const leads = {
      count: jest.fn(async () => 3),
      createQueryBuilder: jest.fn(() => {
        const builder: any = {
          andWhere: jest.fn(() => builder),
          select: jest.fn(() => builder),
          addSelect: jest.fn(() => builder),
          groupBy: jest.fn(() => builder),
          getRawMany: jest.fn(async () => [{ count: '3' }]),
        };
        return builder;
      }),
    };
    const appointments = {
      count: jest.fn(async () => 4),
      createQueryBuilder: jest.fn(() => {
        const builder: any = {
          andWhere: jest.fn(() => builder),
          select: jest.fn(() => builder),
          addSelect: jest.fn(() => builder),
          groupBy: jest.fn(() => builder),
          getRawMany: jest.fn(async () => [{ count: '4' }]),
        };
        return builder;
      }),
    };
    const tenants = {
      find: jest.fn(async () => [
        { id: 'tenant-1', name: 'Alpha Realty' },
        { id: 'tenant-2', name: 'Beta Homes' },
      ]),
    };
    const durableJobs = { register: jest.fn(), schedule: jest.fn().mockResolvedValue({}) };
    const preferences = {
      find: jest.fn(async () => []),
    };
    const service = new NotificationDigestService(
      notifications as any,
      users as any,
      adminNotifications as any,
      leads as any,
      appointments as any,
      tenants as any,
      preferences as any,
      durableJobs as any,
    );
    return { service, notifications, users, adminNotifications, durableJobs, tenants };
  }

  it('registers digest jobs', () => {
    const { service, durableJobs } = setup();
    service.onModuleInit();
    expect(durableJobs.register).toHaveBeenCalledWith(
      'notifications.client_digest',
      expect.any(Function),
    );
    expect(durableJobs.register).toHaveBeenCalledWith(
      'notifications.admin_digest',
      expect.any(Function),
    );
    expect(durableJobs.register).toHaveBeenCalledWith(
      'notifications.weekly_digest',
      expect.any(Function),
    );
  });

  it('20. daily digest aggregates activity and honors preferences', async () => {
    const { service, notifications } = setup();
    const result = await service.sendClientDailyDigest({ tenantId: 'tenant-1' });
    expect(result.sent).toBe(1);
    expect(notifications.createForTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        severity: 'info',
        templateId: 'digest.daily_client',
      }),
    );
    const call = notifications.createForTenant.mock.calls[0]![0];
    expect(call.templateContext.newLeads).toBe(3);
    expect(call.templateContext.upcomingAppointments).toBe(4);
    expect(call.templateContext.unresolvedNotifications).toBe(2);
    // Only the owner is targeted (digest.audience = owner).
    expect(call.assignedUserId).toBeUndefined();
    expect(call.recipientUserId).toBeUndefined();

    // Preference opt-out → skipped.
    const { service: service2, notifications: notifications2 } = setup();
    const result2 = await service2.sendClientDailyDigest({ tenantId: 'tenant-1' });
    expect(result2.sent).toBe(1);
    expect(notifications2.createForTenant).toHaveBeenCalledTimes(1);
  });

  it('21. digest does not include another tenant\u2019s data', async () => {
    const { service, notifications } = setup();
    await service.sendClientDailyDigest({ tenantId: 'tenant-1' });
    await service.sendClientDailyDigest({ tenantId: 'tenant-2' });
    const calls = notifications.createForTenant.mock.calls.map((c: any[]) => c[0]);
    const tenant1Call = calls.find((c: any) => c.tenantId === 'tenant-1');
    const tenant2Call = calls.find((c: any) => c.tenantId === 'tenant-2');
    expect(tenant1Call).toBeDefined();
    expect(tenant2Call).toBeDefined();
    // Each digest targets exactly its own tenant's opted-in owners.
    expect(tenant1Call!.exactRecipientIds).toEqual(['user-owner-1']);
    expect(tenant2Call!.exactRecipientIds).toEqual(['user-owner-2b']);
    expect(tenant1Call!.tenantId).not.toBe(tenant2Call!.tenantId);
  });

  it('22. human handoffs count uses the unified handoff.created event', async () => {
    const { service, adminNotifications } = setup();
    await service.sendClientDailyDigest({ tenantId: 'tenant-1' });
    const handoffCountCall = adminNotifications.count.mock.calls.find(
      (call: any[]) => call[0]?.where?.eventType === 'handoff.created',
    );
    expect(handoffCountCall).toBeDefined();
    // The legacy dead event type must never be queried.
    const legacyCall = adminNotifications.count.mock.calls.find(
      (call: any[]) => call[0]?.where?.eventType === 'lead.ai_handoff',
    );
    expect(legacyCall).toBeUndefined();
  });

  it('admin digest notifies each opted-in platform operator', async () => {
    const { service, notifications } = setup();
    await service.sendAdminDailyDigest();
    expect(notifications.createForPlatform).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'info',
        templateId: 'digest.daily_admin',
        audience: 'super_admin',
        // user-owner-2 disabled the daily digest; the agent is not an operator.
        exactRecipientIds: ['user-owner-1'],
      }),
    );
    const call = notifications.createForPlatform.mock.calls[0]![0]!;
    expect(call!.templateContext.totalNotifications).toBe(7);
    expect(call!.templateContext.criticalCount).toBe(0);
    expect(call!.templateContext.warningCount).toBe(2);
  });
});
