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
        eventType: 'lead.ai_handoff',
        templateId: 'lead.ai_handoff',
        deduplicationKey: 'ai-handoff:handoff-1',
      }),
    );
    expect(durableJobs.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        taskType: 'notifications.ai_handoff_reminder',
        dedupeKey: 'ai-handoff-reminder:handoff-1',
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
        dedupeKey: 'ai-handoff:handoff-1',
        leadId: 'lead-1',
        leadName: 'Jordan Buyer',
        assignedUserId: 'user-staff',
        reason: 'Low confidence',
      },
    });
    expect(adminNotifications.count).toHaveBeenCalledWith({
      where: { deduplicationKey: 'ai-handoff:handoff-1', readAt: expect.anything() },
    });
    expect(notifications.createForTenant).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'lead.ai_handoff_reminder',
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
        dedupeKey: 'ai-handoff:handoff-1',
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
});
