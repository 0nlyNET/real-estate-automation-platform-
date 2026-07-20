import { OperationalRemindersService } from './operational-reminders.service';

describe('operational notification reminders', () => {
  it('creates daily, assigned reminders for due work and untouched leads', async () => {
    const now = new Date('2026-07-20T12:00:00.000Z');
    const tasks = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'task-1',
          title: 'Finish client test',
          status: 'open',
          priority: 'critical',
          assignedOperatorId: 'staff-1',
          dueAt: new Date('2026-07-20T10:00:00.000Z'),
        },
      ]),
    };
    const applications = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'application-1',
          name: 'Jordan Client',
          company: 'Lakeview Realty',
          assignedOperatorId: null,
        },
      ]),
    };
    const notifications = { createForPlatform: jest.fn().mockResolvedValue([]) };
    const service = new OperationalRemindersService(
      tasks as any,
      applications as any,
      notifications as any,
    );

    await expect(service.run(now)).resolves.toEqual({ tasks: 1, applications: 1 });
    expect(notifications.createForPlatform).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        eventType: 'task.overdue',
        severity: 'critical',
        assignedOperatorId: 'staff-1',
        deduplicationKey: 'task-reminder:task-1:overdue:2026-07-20',
      }),
    );
    expect(notifications.createForPlatform).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        eventType: 'lead.follow_up_overdue',
        deduplicationKey: 'lead-follow-up:application-1:2026-07-20',
      }),
    );
  });
});
