import { IsNull, Not } from 'typeorm';
import { NotificationsService } from './notifications.service';

describe('admin notifications', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.PLATFORM_ADMIN_EMAILS = 'owner@example.com';
    process.env.PLATFORM_STAFF_EMAILS = 'staff@example.com';
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  function setup(preferencePatch: Record<string, unknown> = {}) {
    const stored: any[] = [];
    const notifications = {
      findOne: jest.fn(async ({ where, order }: any) => {
        if (where.id) {
          return stored.find((row) => row.id === where.id && row.recipientUserId === where.recipientUserId) || null;
        }
        if (where.incidentKey) {
          const rows = stored.filter((row) => row.incidentKey === where.incidentKey);
          return order?.createdAt === 'DESC'
            ? rows.sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0] || null
            : rows[0] || null;
        }
        return stored.find(
          (row) => row.recipientUserId === where.recipientUserId &&
            row.deduplicationKey === where.deduplicationKey,
        ) || null;
      }),
      create: jest.fn((value) => ({ ...value })),
      save: jest.fn(async (value) => {
        const row = { id: value.id || `notification-${stored.length + 1}`, pushAttemptCount: 0, ...value };
        const index = stored.findIndex((item) => item.id === row.id);
        if (index >= 0) stored[index] = row;
        else stored.push(row);
        return row;
      }),
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn(),
    };
    const subscriptions = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(async (value) => value),
    };
    const preference = {
      recipientUserId: 'user-owner', inAppEnabled: true, pushEnabled: true,
      privacyMode: true, categorySettings: {}, severitySettings: {}, quietHoursEnabled: false,
      quietHoursStart: '21:00', quietHoursEnd: '08:00', timezone: 'America/New_York',
      ...preferencePatch,
    };
    const preferences = {
      findOne: jest.fn(async ({ where }: any) => ({ ...preference, recipientUserId: where.recipientUserId })),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const users = {
      find: jest.fn().mockResolvedValue([
        { id: 'user-owner', tenantId: 'tenant-1', role: 'owner', email: 'owner@example.com', isActive: true, isEmailVerified: true },
        { id: 'user-staff', tenantId: 'tenant-1', role: 'agent', email: 'staff@example.com', isActive: true, isEmailVerified: true },
      ]),
      findOne: jest.fn(),
    };
    const service = new NotificationsService(
      notifications as any,
      subscriptions as any,
      preferences as any,
      users as any,
    );
    return { service, stored, notifications, users, subscriptions };
  }

  it('creates operational alerts for both roles, financial alerts for owner only, and deduplicates retries', async () => {
    const { service, stored } = setup();
    const lead = {
      eventType: 'lead.application_received', category: 'leads' as const,
      severity: 'warning' as const, title: 'New lead', message: 'Review it',
      deduplicationKey: 'application:1', actionUrl: '/admin/dashboard?view=leads',
    };
    await service.createForPlatform(lead);
    await service.createForPlatform(lead);
    expect(stored.filter((row) => row.deduplicationKey === 'application:1')).toHaveLength(2);

    await service.createForPlatform({
      eventType: 'billing.invoice_paid', category: 'billing', severity: 'success',
      title: 'Invoice paid', message: 'Payment received', deduplicationKey: 'stripe:evt_1',
      actionUrl: '/admin/dashboard?view=billing',
    });
    const financial = stored.filter((row) => row.deduplicationKey === 'stripe:evt_1');
    expect(financial).toHaveLength(1);
    expect(financial[0].recipientUserId).toBe('user-owner');
  });

  it('does not deliver owner-only billing or system alerts to an assigned staff account', async () => {
    const { service, stored, users } = setup();
    users.findOne.mockResolvedValue({
      id: 'user-staff',
      email: 'staff@example.com',
      isActive: true,
      isEmailVerified: true,
    });
    await service.createForPlatform({
      eventType: 'billing.payment_failed',
      category: 'billing',
      severity: 'warning',
      title: 'Payment failed',
      message: 'Review billing',
      deduplicationKey: 'staff-financial-denied',
      assignedOperatorId: 'user-staff',
    });
    await service.createForPlatform({
      eventType: 'system.health_incident',
      category: 'system',
      severity: 'critical',
      title: 'System incident',
      message: 'Review health',
      deduplicationKey: 'staff-system-denied',
      assignedOperatorId: 'user-staff',
    });
    expect(stored).toHaveLength(0);
  });

  it('rejects user-controlled external action links before persisting', async () => {
    const { service, stored } = setup();
    await expect(service.createForPlatform({
      eventType: 'test', category: 'system', severity: 'warning', title: 'Test',
      message: 'Test', deduplicationKey: 'unsafe', actionUrl: 'https://evil.example/path',
    })).resolves.toEqual([]);
    expect(stored).toHaveLength(0);
  });

  it('creates tenant-scoped client alerts with safe app links for the owner and assigned agent', async () => {
    const { service, stored } = setup();
    await service.createForTenant({
      tenantId: 'tenant-1',
      assignedUserId: 'user-staff',
      eventType: 'handoff.created',
      category: 'tasks',
      severity: 'warning',
      title: 'Lead needs you',
      message: 'Call today',
      deduplicationKey: 'handoff:1',
      actionUrl: '/app/dashboard?leadId=lead-1',
    });
    expect(stored.filter((row) => row.deduplicationKey === 'handoff:1')).toHaveLength(2);
    expect(stored.every((row) => row.actionUrl.startsWith('/app'))).toBe(true);
  });

  it('revokes an expired push subscription after the push service returns 410', async () => {
    const { service, subscriptions } = setup();
    const subscription = { active: true, failureCount: 0, revokedAt: null, lastFailureAt: null };
    await (service as any).recordSubscriptionFailure(subscription, 410);
    expect(subscription).toMatchObject({ active: false, failureCount: 1 });
    expect(subscription.revokedAt).toBeInstanceOf(Date);
    expect(subscriptions.save).toHaveBeenCalledWith(subscription);
  });

  it('scopes notification reads and applies category, severity, and read filters', async () => {
    const { service, notifications } = setup();
    await service.listForUser('user-owner', {
      category: 'leads',
      severity: 'warning',
      read: 'read',
      take: 500,
      skip: -10,
    });
    expect(notifications.find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        recipientUserId: 'user-owner',
        category: 'leads',
        severity: 'warning',
        readAt: Not(IsNull()),
      }),
      take: 100,
      skip: 0,
    }));
  });

  it('respects the in-app preference and never allows critical push severity to be disabled', async () => {
    const disabled = setup({ inAppEnabled: false });
    await expect(disabled.service.listForUser('user-owner', {})).resolves.toEqual([]);
    expect(disabled.notifications.find).not.toHaveBeenCalled();

    const enabled = setup();
    await expect(enabled.service.updatePreferences('user-owner', {
      severitySettings: { critical: false, info: true },
    } as any)).resolves.toMatchObject({
      severitySettings: expect.objectContaining({ critical: true, info: true }),
    });
  });

  it('only marks a notification owned by the requesting operator as read', async () => {
    const { service, stored } = setup();
    stored.push({ id: 'note-1', recipientUserId: 'user-staff', readAt: null });
    await expect(service.markRead('user-owner', 'note-1')).resolves.toEqual({ ok: false });
    await expect(service.markRead('user-staff', 'note-1')).resolves.toEqual({ ok: true });
    expect(stored[0].readAt).toBeInstanceOf(Date);
  });
});
