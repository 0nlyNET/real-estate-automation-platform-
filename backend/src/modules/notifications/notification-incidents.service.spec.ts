import { NotificationIncidentsService } from './notification-incidents.service';

describe('notification incidents lifecycle', () => {
  function setup() {
    const stored: any[] = [];
    const incidents = {
      findOne: jest.fn(async ({ where }: any) =>
        stored.find((row) => row.incidentKey === where.incidentKey) || null,
      ),
      create: jest.fn((value: any) => ({ ...value })),
      save: jest.fn(async (value: any) => {
        const row = { id: value.id || `incident-${stored.length + 1}`, ...value };
        const index = stored.findIndex((item) => item.id === row.id);
        if (index >= 0) stored[index] = row;
        else stored.push(row);
        return row;
      }),
    };
    const notifications = {
      createForPlatform: jest.fn(async () => []),
      createForTenant: jest.fn(async () => []),
    };
    const service = new NotificationIncidentsService(
      incidents as any,
      notifications as any,
    );
    const failureInput = (overrides: Record<string, unknown> = {}) => ({
      incidentKey: 'sendgrid:auth',
      eventType: 'integration.failed',
      category: 'integrations' as const,
      title: 'SendGrid auth failing',
      message: 'SendGrid authentication failed.',
      templateId: 'integration.disconnected',
      templateContext: { provider: 'SendGrid' },
      ...overrides,
    });
    return { service, stored, incidents, notifications, failureInput };
  }

  it('13. duplicate incident sends only once (1st failure in-app only, further failures deduplicated)', async () => {
    const { service, notifications } = setup();
    // 1st failure: info severity → in-app only, no email expected downstream.
    await service.recordFailure({
      incidentKey: 'sendgrid:auth',
      eventType: 'integration.failed',
      category: 'integrations',
      title: 't',
      message: 'm',
    });
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(1);
    expect(notifications.createForPlatform).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'info' }),
    );

    // 2nd failure: still below the warning threshold → no new notification.
    await service.recordFailure({
      incidentKey: 'sendgrid:auth',
      eventType: 'integration.failed',
      category: 'integrations',
      title: 't',
      message: 'm',
    });
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(1);

    // 3rd failure: warning threshold → exactly one warning.
    await service.recordFailure({
      incidentKey: 'sendgrid:auth',
      eventType: 'integration.failed',
      category: 'integrations',
      title: 't',
      message: 'm',
    });
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(2);
    expect(notifications.createForPlatform).toHaveBeenLastCalledWith(
      expect.objectContaining({ severity: 'warning' }),
    );

    // 4th failure: no escalation yet → still no new notification.
    await service.recordFailure({
      incidentKey: 'sendgrid:auth',
      eventType: 'integration.failed',
      category: 'integrations',
      title: 't',
      message: 'm',
    });
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(2);
  });

  it('14. severity escalation sends one additional notification (warning -> critical)', async () => {
    const { service, notifications, failureInput } = setup();
    for (let i = 0; i < 4; i++) {
      await service.recordFailure(failureInput());
    }
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(2); // info + warning
    const severities = notifications.createForPlatform.mock.calls.map(
      (call: any[]) => call[0].severity,
    );
    expect(severities).toEqual(['info', 'warning']);

    // 5th failure escalates to critical → one additional notification.
    const incident = await service.recordFailure(failureInput());
    expect(incident.status).toBe('escalated');
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(3);
    expect(notifications.createForPlatform).toHaveBeenLastCalledWith(
      expect.objectContaining({ severity: 'critical' }),
    );

    // 6th+ failures: no further notifications.
    await service.recordFailure(failureInput());
    await service.recordFailure(failureInput());
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(3);
  });

  it('escalates immediately on platformImpact', async () => {
    const { service, notifications, failureInput } = setup();
    const incident = await service.recordFailure(
      failureInput({ platformImpact: true }),
    );
    expect(incident.status).toBe('escalated');
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(1);
    expect(notifications.createForPlatform).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'critical' }),
    );
  });

  it('15. recovery sends exactly one recovery email', async () => {
    const { service, notifications, failureInput, stored } = setup();
    // No open incident → recovery is a no-op.
    await expect(
      service.recordRecovery({
        incidentKey: 'sendgrid:auth',
        eventType: 'integration.recovered',
        title: 'SendGrid recovered',
        message: 'SendGrid is healthy again.',
      }),
    ).resolves.toBeNull();
    expect(notifications.createForPlatform).not.toHaveBeenCalled();

    for (let i = 0; i < 3; i++) {
      await service.recordFailure(failureInput());
    }
    const callsBefore = notifications.createForPlatform.mock.calls.length;

    const recovered = await service.recordRecovery({
      incidentKey: 'sendgrid:auth',
      eventType: 'integration.recovered',
      title: 'SendGrid recovered',
      message: 'SendGrid recovered after 17 minutes.',
      templateId: 'integration.recovered',
      templateContext: { provider: 'SendGrid', downtimeMinutes: 17 },
    });
    expect(recovered?.status).toBe('recovered');
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(callsBefore + 1);
    expect(notifications.createForPlatform).toHaveBeenLastCalledWith(
      expect.objectContaining({
        severity: 'success',
        eventType: 'integration.recovered',
        templateId: 'integration.recovered',
      }),
    );

    // A second recovery call sends nothing more.
    await service.recordRecovery({
      incidentKey: 'sendgrid:auth',
      eventType: 'integration.recovered',
      title: 'SendGrid recovered',
      message: 'SendGrid recovered after 17 minutes.',
    });
    expect(notifications.createForPlatform).toHaveBeenCalledTimes(callsBefore + 1);
    expect(stored).toHaveLength(1);
  });

  it('routes tenant-scoped incidents to createForTenant', async () => {
    const { service, notifications, failureInput } = setup();
    for (let i = 0; i < 3; i++) {
      await service.recordFailure(failureInput({ tenantId: 'tenant-9' }));
    }
    expect(notifications.createForTenant).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-9', severity: 'warning' }),
    );
    expect(notifications.createForPlatform).not.toHaveBeenCalled();
  });
});
