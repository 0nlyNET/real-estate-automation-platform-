import { OperationalEventsService } from './operational-events.service';

describe('operational events facade', () => {
  function setup() {
    const notifications = {
      createForPlatform: jest.fn(async (..._args: any[]) => []),
      createForTenant: jest.fn(async (..._args: any[]) => [{ id: 'n1' }]),
    };
    const incidents = {
      recordFailure: jest.fn(async () => ({})),
      recordRecovery: jest.fn(async () => ({})),
    };
    const adminNotifications = {
      count: jest.fn(async () => 1),
    };
    const durableJobs = {
      register: jest.fn(),
      schedule: jest.fn().mockResolvedValue({}),
    };
    const service = new OperationalEventsService(
      notifications as any,
      incidents as any,
      adminNotifications as any,
      durableJobs as any,
    );
    return { service, notifications, incidents, adminNotifications, durableJobs };
  }

  const handoffInput = () => ({
    tenantId: 'tenant-1',
    leadId: 'lead-1',
    leadName: 'Jordan Buyer',
    reason: 'Low confidence',
    summary: 'Asked about pricing.',
    assignedUserId: 'user-staff',
    handoffId: 'handoff-1',
  });

  it('aiHandoff notifies with the handoff template and schedules one 4h reminder', async () => {
    const { service, notifications, durableJobs } = setup();
    service.onModuleInit();
    await service.aiHandoff(handoffInput());
    expect(notifications.createForTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        eventType: 'handoff.created',
        templateId: 'handoff.created',
        deduplicationKey: 'handoff:handoff-1',
      }),
    );
    expect(durableJobs.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'notifications.ai_handoff_reminder',
        dedupeKey: 'handoff-reminder:handoff-1',
      }),
    );
    const scheduledAt: Date = durableJobs.schedule.mock.calls[0][0].nextRunAt;
    const delayHours =
      (scheduledAt.getTime() - Date.now()) / (60 * 60_000);
    expect(delayHours).toBeGreaterThan(3.9);
    expect(delayHours).toBeLessThan(4.1);
  });

  it('registers the reminder handler on module init', () => {
    const { service, durableJobs } = setup();
    service.onModuleInit();
    expect(durableJobs.register).toHaveBeenCalledWith(
      'notifications.ai_handoff_reminder',
      expect.any(Function),
    );
  });

  it('sends the reminder when the handoff is still unread', async () => {
    const notifications = {
      createForTenant: jest.fn(async (..._args: any[]) => [{ id: 'n2' }]),
    };
    const adminNotifications = { count: jest.fn(async () => 1) };
    const durableJobs = { register: jest.fn(), schedule: jest.fn() };
    const service = new OperationalEventsService(
      notifications as any,
      {} as any,
      adminNotifications as any,
      durableJobs as any,
    );
    service.onModuleInit();
    const handler = durableJobs.register.mock.calls[0][1];
    await handler({
      payload: {
        tenantId: 'tenant-1',
        dedupeKey: 'handoff:handoff-1',
        leadId: 'lead-1',
        leadName: 'Jordan Buyer',
        assignedUserId: 'user-staff',
        reason: 'Low confidence',
      },
    });
    expect(adminNotifications.count).toHaveBeenCalledWith({
      where: { deduplicationKey: 'handoff:handoff-1', readAt: expect.anything() },
    });
    expect(notifications.createForTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'handoff.reminder',
        tenantId: 'tenant-1',
      }),
    );
  });

  it('skips the reminder when the handoff was already read', async () => {
    const notifications = {
      createForTenant: jest.fn(async (..._args: any[]) => []),
    };
    const adminNotifications = { count: jest.fn(async () => 0) };
    const durableJobs = { register: jest.fn(), schedule: jest.fn() };
    const service = new OperationalEventsService(
      notifications as any,
      {} as any,
      adminNotifications as any,
      durableJobs as any,
    );
    service.onModuleInit();
    const handler = durableJobs.register.mock.calls[0][1];
    await handler({
      payload: {
        tenantId: 'tenant-1',
        dedupeKey: 'handoff:handoff-1',
        leadId: 'lead-1',
        leadName: 'Jordan Buyer',
      },
    });
    expect(notifications.createForTenant).not.toHaveBeenCalled();
  });

  it('uses stable dedupe keys for repeatable events', async () => {
    const { service, notifications } = setup();
    await service.automationPaused({ tenantId: 'tenant-1', reason: 'x' });
    await service.automationPaused({ tenantId: 'tenant-1', reason: 'x' });
    const keys = notifications.createForTenant.mock.calls.map(
      (call: any[]) => call[0].deduplicationKey,
    );
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toContain('automation-paused:tenant-1:');
  });

  it('aiHandoff maps urgent priority to critical severity', async () => {
    const { service, notifications } = setup();
    await service.aiHandoff({ ...handoffInput(), priority: 'urgent' });
    expect(notifications.createForTenant).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical', eventType: 'handoff.created' }),
    );
  });

  it('handoffResolved marks the handoff notifications read so the reminder stays silent', async () => {
    const updateBuilder: any = {};
    updateBuilder.update = jest.fn(() => updateBuilder);
    updateBuilder.set = jest.fn(() => updateBuilder);
    updateBuilder.where = jest.fn(() => updateBuilder);
    updateBuilder.andWhere = jest.fn(() => updateBuilder);
    updateBuilder.execute = jest.fn(async () => ({ affected: 2 }));
    const adminNotifications = { createQueryBuilder: jest.fn(() => updateBuilder) };
    const notifications = {
      createForPlatform: jest.fn(async () => []),
      createForTenant: jest.fn(async () => []),
    };
    const service = new OperationalEventsService(
      notifications as any,
      {} as any,
      adminNotifications as any,
      undefined,
    );
    const result = await service.handoffResolved({
      tenantId: 'tenant-1',
      handoffId: 'handoff-1',
      leadId: 'lead-1',
    });
    expect(result).toEqual({ markedRead: 2 });
    expect(updateBuilder.where).toHaveBeenCalledWith(
      'deduplicationKey IN (:...keys)',
      { keys: ['handoff:handoff-1', 'handoff:handoff:lead-1'] },
    );
    expect(updateBuilder.andWhere).toHaveBeenCalledWith('readAt IS NULL');
  });

  it('handoffResolved never throws when the notification store is unavailable', async () => {
    const service = new OperationalEventsService(
      { createForTenant: jest.fn() } as any,
      {} as any,
      undefined,
      undefined,
    );
    await expect(
      service.handoffResolved({ tenantId: 'tenant-1', handoffId: 'handoff-1' }),
    ).resolves.toEqual({ markedRead: 0 });
  });
});
