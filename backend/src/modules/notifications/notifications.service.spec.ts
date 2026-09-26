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

  function setup(preferencePatch: Record<string, unknown> = {}, opts: {
    durableJobs?: any;
    tenantUsers?: any[];
  } = {}) {
    const stored: any[] = [];
    const notifications = {
      findOne: jest.fn(async ({ where, order }: any) => {
        if (where.id) {
          return stored.find((row) => row.id === where.id &&
            (!where.recipientUserId || row.recipientUserId === where.recipientUserId)) || null;
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
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => ({ ...value })),
      save: jest.fn(async (value) => value),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
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
      createQueryBuilder: jest.fn(),
    };
    const tenantUsers = opts.tenantUsers || [
      { id: 'user-owner', tenantId: 'tenant-1', role: 'owner', email: 'owner@example.com', isActive: true, isEmailVerified: true },
      { id: 'user-staff', tenantId: 'tenant-1', role: 'agent', email: 'staff@example.com', isActive: true, isEmailVerified: true },
    ];
    const users = {
      find: jest.fn(async ({ where }: any) => {
        if (where?.tenantId) return tenantUsers.filter((u) => u.tenantId === where.tenantId);
        return tenantUsers;
      }),
      findOne: jest.fn(async ({ where }: any) => {
        const directory: Record<string, any> = {};
        for (const u of tenantUsers) directory[u.id] = u;
        return directory[where.id] || null;
      }),
    };
    const mailService = { sendEmail: jest.fn().mockResolvedValue({ messageId: 'sg-test-1', status: 'accepted' }) };
    const durableJobs = opts.durableJobs || undefined;
    const service = new NotificationsService(
      notifications as any,
      subscriptions as any,
      preferences as any,
      users as any,
      mailService as any,
      durableJobs as any,
    );
    return { service, stored, notifications, users, subscriptions, preferences, mailService, durableJobs };
  }

  it('recovers concurrent first-login preference creation without overwriting the winner', async () => {
    const h = setup();
    const winner = { recipientUserId: 'user-owner', inAppEnabled: false };
    (h.preferences.findOne as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    const insert = { insert: jest.fn().mockReturnThis(), values: jest.fn().mockReturnThis(), orIgnore: jest.fn().mockReturnThis(), execute: jest.fn().mockResolvedValue({ identifiers: [] }) };
    h.preferences.createQueryBuilder.mockReturnValue(insert);
    await expect(h.service.getPreferences('user-owner')).resolves.toBe(winner);
    expect(insert.orIgnore).toHaveBeenCalled();
    expect(h.preferences.save).not.toHaveBeenCalled();
  });

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

  it('rejects internal and unapproved push endpoints before they can be fetched', async () => {
    process.env.VAPID_SUBJECT = 'mailto:security@example.com';
    process.env.VAPID_PUBLIC_KEY =
      'BPPG2fcmvRLzseMe58txhiEzWtGSc-L4PLyKlp6N2Y2OfZYPNmFECkQt0Tq_jXxihaEY8ayQPcX8kO7xYE4ocDw';
    process.env.VAPID_PRIVATE_KEY =
      '2b7tEAwUK1yGvPXSGJvhJmE79TEGjCIi74D6DHASlE0';
    const { service, subscriptions } = setup();
    const keys = { p256dh: 'public-key', auth: 'auth-key' };

    for (const endpoint of [
      'https://127.0.0.1/admin',
      'https://169.254.169.254/latest/meta-data',
      'https://internal.service.local/push',
      'https://attacker.example/push',
      'https://fcm.googleapis.com.evil.example/push',
    ]) {
      await expect(
        service.registerSubscription('user-owner', { endpoint, keys }),
      ).rejects.toBeInstanceOf(Error);
    }
    expect(subscriptions.save).not.toHaveBeenCalled();
  });

  it('accepts a canonical endpoint from an approved Web Push provider', async () => {
    process.env.VAPID_SUBJECT = 'mailto:security@example.com';
    process.env.VAPID_PUBLIC_KEY =
      'BPPG2fcmvRLzseMe58txhiEzWtGSc-L4PLyKlp6N2Y2OfZYPNmFECkQt0Tq_jXxihaEY8ayQPcX8kO7xYE4ocDw';
    process.env.VAPID_PRIVATE_KEY =
      '2b7tEAwUK1yGvPXSGJvhJmE79TEGjCIi74D6DHASlE0';
    const { service, subscriptions } = setup();
    await expect(
      service.registerSubscription('user-owner', {
        endpoint: 'https://fcm.googleapis.com/fcm/send/device-id#fragment',
        keys: { p256dh: 'public-key', auth: 'auth-key' },
      }),
    ).resolves.toEqual({ ok: true });
    expect(subscriptions.save).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://fcm.googleapis.com/fcm/send/device-id',
        recipientUserId: 'user-owner',
      }),
    );
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
    await expect(service.markRead('user-owner', 'note-1')).rejects.toThrow('Notification not found');
    await expect(service.markRead('user-staff', 'note-1')).resolves.toEqual({ ok: true });
    expect(stored[0].readAt).toBeInstanceOf(Date);
  });

  it('delivers critical notifications by email when emailEnabled', async () => {
    const { service, mailService, stored } = setup({ emailEnabled: true, privacyMode: false });
    await service.createForPlatform({
      eventType: 'backup.failed',
      category: 'system',
      severity: 'critical',
      title: 'Backup failed',
      message: 'Nightly backup failed at 2 AM.',
      deduplicationKey: 'backup-failed-email-1',
    });
    expect(mailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.com',
        subject: expect.stringContaining('[CRITICAL]'),
      }),
    );
    expect(stored[0].emailDeliveryStatus).toBe('sent');
    expect(stored[0].emailSentAt).toBeInstanceOf(Date);
  });

  it('skips email delivery when emailEnabled is false', async () => {
    const { service, mailService, stored } = setup({ emailEnabled: false, privacyMode: false });
    await service.createForPlatform({
      eventType: 'backup.failed',
      category: 'system',
      severity: 'critical',
      title: 'Backup failed',
      message: 'Nightly backup failed.',
      deduplicationKey: 'backup-failed-email-2',
    });
    expect(mailService.sendEmail).not.toHaveBeenCalled();
    expect(stored[0].emailDeliveryStatus).toBe('skipped');
  });

  it('records email failure without breaking notification creation', async () => {
    const { service, mailService, stored } = setup({ emailEnabled: true, privacyMode: false });
    mailService.sendEmail.mockRejectedValueOnce(new Error('SendGrid down'));
    const created = await service.createForPlatform({
      eventType: 'backup.failed',
      category: 'system',
      severity: 'critical',
      title: 'Backup failed',
      message: 'Nightly backup failed.',
      deduplicationKey: 'backup-failed-email-3',
    });
    expect(created).toHaveLength(1);
    expect(stored[0].emailDeliveryStatus).toBe('failed');
  });

  it('critical email bypasses quiet hours but warning email does not', async () => {
    const quiet = { quietHoursEnabled: true, quietHoursStart: '00:00', quietHoursEnd: '23:59' };
    const critical = setup({ emailEnabled: true, privacyMode: false, ...quiet });
    await critical.service.createForPlatform({
      eventType: 'backup.failed',
      category: 'system',
      severity: 'critical',
      title: 'Backup failed',
      message: 'Nightly backup failed.',
      deduplicationKey: 'backup-failed-email-4',
    });
    expect(critical.mailService.sendEmail).toHaveBeenCalledTimes(1);

    const warning = setup({ emailEnabled: true, privacyMode: false, ...quiet });
    await warning.service.createForPlatform({
      eventType: 'sendgrid.bounce_warning',
      category: 'system',
      severity: 'warning',
      title: 'Bounce rate elevated',
      message: 'Bounce rate above threshold.',
      deduplicationKey: 'sendgrid-warning-email-1',
    });
    expect(warning.mailService.sendEmail).not.toHaveBeenCalled();
  });

  // ---- Notification system v1: 21-test suite ----

  it('1. admin warning sends email', async () => {
    const { service, mailService, stored } = setup({ emailEnabled: true, privacyMode: false });
    await service.createForPlatform({
      eventType: 'integration.failed',
      category: 'integrations',
      severity: 'warning',
      audience: 'super_admin',
      title: 'SendGrid auth failing',
      message: 'SendGrid authentication failed repeatedly.',
      deduplicationKey: 't1-warning',
    });
    expect(mailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@example.com' }),
    );
    expect(stored[0].emailDeliveryStatus).toBe('sent');
    expect(stored[0].providerMessageId).toBe('sg-test-1');
  });

  it('2. admin critical sends email', async () => {
    const { service, mailService, stored } = setup({ emailEnabled: true, privacyMode: false });
    await service.createForPlatform({
      eventType: 'system.outage',
      category: 'system',
      severity: 'critical',
      title: 'Production outage',
      message: 'The platform is down.',
      deduplicationKey: 't2-critical',
    });
    expect(mailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(stored[0].emailDeliveryStatus).toBe('sent');
  });

  it('3. INFO does not email by default', async () => {
    const { service, mailService, stored } = setup({ emailEnabled: true, privacyMode: false });
    await service.createForPlatform({
      eventType: 'onboarding.step_completed',
      category: 'onboarding',
      severity: 'info',
      title: 'Step completed',
      message: 'A routine step completed.',
      deduplicationKey: 't3-info',
    });
    expect(mailService.sendEmail).not.toHaveBeenCalled();
    expect(stored[0].emailDeliveryStatus).toBe('skipped');
  });

  it('4. client owner receives integration warning', async () => {
    const { service, mailService, stored } = setup({ emailEnabled: true, privacyMode: false });
    await service.createForTenant({
      tenantId: 'tenant-1',
      eventType: 'integration.failed',
      category: 'integrations',
      severity: 'warning',
      title: 'CRM disconnected',
      message: 'The CRM connection is failing.',
      deduplicationKey: 't4-tenant-warning',
      templateId: 'integration.disconnected',
      templateContext: { provider: 'CRM', actionPath: '/app/settings/integrations' },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].recipientUserId).toBe('user-owner');
    expect(mailService.sendEmail).toHaveBeenCalledTimes(1);
    const call = mailService.sendEmail.mock.calls[0][0];
    expect(call.to).toBe('owner@example.com');
    expect(call.subject).toContain('CRM');
    expect(call.html).toContain('https://www.realtytechai.app/app/settings/integrations');
  });

  it('5. assigned agent receives lead handoff', async () => {
    const { service, mailService, stored } = setup({ emailEnabled: true, privacyMode: false });
    await service.createForTenant({
      tenantId: 'tenant-1',
      assignedUserId: 'user-staff',
      eventType: 'handoff.created',
      category: 'leads',
      severity: 'warning',
      title: 'AI handed off Jordan Buyer',
      message: 'Low confidence response.',
      deduplicationKey: 't5-handoff',
      templateId: 'handoff.created',
      templateContext: {
        leadName: 'Jordan Buyer',
        handoffReason: 'Low confidence',
        summary: 'Asked about pricing.',
        actionPath: '/app/conversations?leadId=lead-1',
      },
    });
    const agentRows = stored.filter((row) => row.recipientUserId === 'user-staff');
    expect(agentRows).toHaveLength(1);
    expect(mailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'staff@example.com' }),
    );
  });

  it('5b. handoff with no tenant recipients escalates to platform admins', async () => {
    const { service, stored } = setup({}, {
      tenantUsers: [
        {
          id: 'user-platform-admin', tenantId: 'other-tenant', role: 'owner',
          email: 'owner@example.com', platformRole: 'super_admin',
          isActive: true, isEmailVerified: true,
        },
      ],
    });
    const rows = await service.createForTenant({
      tenantId: 'tenant-1',
      assignedUserId: 'user-staff',
      eventType: 'handoff.created',
      category: 'leads',
      severity: 'warning',
      title: 'Jordan Buyer needs you',
      message: 'Call the lead today.',
      deduplicationKey: 'handoff:no-recipients-1',
      entityType: 'handoff',
      entityId: 'handoff-1',
    });
    // Never a silent zero-recipient handoff: the platform admin is notified.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].recipientUserId).toBe('user-platform-admin');
    expect(rows[0].title).toContain('[No tenant recipients]');
    expect(rows[0].deduplicationKey).toBe('handoff:no-recipients-1:platform-fallback');
    expect(stored.some((row) => row.recipientUserId === 'user-staff')).toBe(false);
  });

  it('5c. non-handoff, non-critical notification with no recipients stays silent', async () => {
    const { service, stored } = setup({}, { tenantUsers: [] });
    const rows = await service.createForTenant({
      tenantId: 'tenant-1',
      eventType: 'lead.replied',
      category: 'leads',
      severity: 'info',
      title: 'Lead replied',
      message: 'A lead replied.',
      deduplicationKey: 'lead-replied:no-recipients-1',
    });
    expect(rows).toEqual([]);
    expect(stored).toHaveLength(0);
  });

  it('6. unrelated agent does not receive another agent\u2019s lead', async () => {
    const tenantUsers = [
      { id: 'user-owner', tenantId: 'tenant-1', role: 'owner', email: 'owner@example.com', isActive: true, isEmailVerified: true },
      { id: 'user-staff', tenantId: 'tenant-1', role: 'agent', email: 'staff@example.com', isActive: true, isEmailVerified: true },
      { id: 'user-other', tenantId: 'tenant-1', role: 'agent', email: 'other@example.com', isActive: true, isEmailVerified: true },
    ];
    const { service, mailService, stored } = setup(
      { emailEnabled: true, privacyMode: false },
      { tenantUsers },
    );
    await service.createForTenant({
      tenantId: 'tenant-1',
      assignedUserId: 'user-staff',
      eventType: 'handoff.created',
      category: 'leads',
      severity: 'warning',
      title: 'Handoff',
      message: 'Handoff message.',
      deduplicationKey: 't6-handoff',
    });
    expect(stored.some((row) => row.recipientUserId === 'user-other')).toBe(false);
    expect(mailService.sendEmail).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: 'other@example.com' }),
    );
  });

  it('7. Tenant A notification never reaches Tenant B', async () => {
    const tenantUsers = [
      { id: 'user-owner', tenantId: 'tenant-1', role: 'owner', email: 'owner@example.com', isActive: true, isEmailVerified: true },
      { id: 'user-b', tenantId: 'tenant-2', role: 'owner', email: 'b@example.com', isActive: true, isEmailVerified: true },
    ];
    const { service, mailService, stored } = setup(
      { emailEnabled: true, privacyMode: false },
      { tenantUsers },
    );
    await service.createForTenant({
      tenantId: 'tenant-1',
      eventType: 'lead.hot_lead',
      category: 'leads',
      severity: 'warning',
      title: 'Hot lead',
      message: 'Hot lead in tenant 1.',
      deduplicationKey: 't7-tenant-isolation',
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].recipientUserId).toBe('user-owner');
    expect(mailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(mailService.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@example.com' }),
    );
  });

  it('8. billing notification only goes to permitted roles', async () => {
    const tenantUsers = [
      { id: 'user-owner', tenantId: 'tenant-1', role: 'owner', email: 'owner@example.com', isActive: true, isEmailVerified: true },
      { id: 'user-admin', tenantId: 'tenant-1', role: 'admin', email: 'admin@example.com', isActive: true, isEmailVerified: true },
      { id: 'user-staff', tenantId: 'tenant-1', role: 'agent', email: 'staff@example.com', isActive: true, isEmailVerified: true },
    ];
    const { service, stored } = setup(
      { emailEnabled: true, privacyMode: false },
      { tenantUsers },
    );
    await service.createForTenant({
      tenantId: 'tenant-1',
      eventType: 'billing.payment_failed',
      category: 'billing',
      severity: 'warning',
      title: 'Payment failed',
      message: 'A payment failed.',
      deduplicationKey: 't8-billing-roles',
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].recipientUserId).toBe('user-owner');
  });

  it('9. email preference disabled suppresses optional email', async () => {
    const { service, mailService, stored } = setup({ emailEnabled: false, privacyMode: false });
    await service.createForPlatform({
      eventType: 'integration.failed',
      category: 'integrations',
      severity: 'warning',
      title: 'Integration warning',
      message: 'Something needs attention.',
      deduplicationKey: 't9-pref-off',
    });
    expect(mailService.sendEmail).not.toHaveBeenCalled();
    expect(stored[0].emailDeliveryStatus).toBe('skipped');
  });

  it('10. critical reaches required recipient despite category/severity opt-outs, but honors master emailEnabled', async () => {
    const optedOut = setup({
      emailEnabled: true,
      privacyMode: false,
      categorySettings: { system: false },
      severitySettings: { warning: false, critical: false },
    });
    await optedOut.service.createForPlatform({
      eventType: 'system.outage',
      category: 'system',
      severity: 'critical',
      title: 'Critical incident',
      message: 'Immediate action required.',
      deduplicationKey: 't10-critical-optout',
    });
    expect(optedOut.mailService.sendEmail).toHaveBeenCalledTimes(1);

    const masterOff = setup({ emailEnabled: false, privacyMode: false });
    await masterOff.service.createForPlatform({
      eventType: 'system.outage',
      category: 'system',
      severity: 'critical',
      title: 'Critical incident',
      message: 'Immediate action required.',
      deduplicationKey: 't10-critical-masteroff',
    });
    expect(masterOff.mailService.sendEmail).not.toHaveBeenCalled();
    expect(masterOff.stored[0].emailDeliveryStatus).toBe('skipped');
  });

  it('11. quiet hours suppress normal notification', async () => {
    const { service, mailService, stored } = setup({
      emailEnabled: true,
      privacyMode: false,
      quietHoursEnabled: true,
      quietHoursStart: '00:00',
      quietHoursEnd: '23:59',
    });
    await service.createForPlatform({
      eventType: 'integration.failed',
      category: 'integrations',
      severity: 'warning',
      title: 'Integration warning',
      message: 'Needs attention.',
      deduplicationKey: 't11-quiet',
    });
    expect(mailService.sendEmail).not.toHaveBeenCalled();
    expect(stored[0].emailDeliveryStatus).toBe('skipped');
  });

  it('12. critical bypasses quiet hours', async () => {
    const { service, mailService } = setup({
      emailEnabled: true,
      privacyMode: false,
      quietHoursEnabled: true,
      quietHoursStart: '00:00',
      quietHoursEnd: '23:59',
    });
    await service.createForPlatform({
      eventType: 'system.outage',
      category: 'system',
      severity: 'critical',
      title: 'Critical incident',
      message: 'Immediate action required.',
      deduplicationKey: 't12-critical-quiet',
    });
    expect(mailService.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('16. email provider failure preserves in-app notification', async () => {
    const { service, mailService, stored } = setup({ emailEnabled: true, privacyMode: false });
    mailService.sendEmail.mockRejectedValueOnce(new Error('SendGrid down'));
    const created = await service.createForPlatform({
      eventType: 'backup.failed',
      category: 'system',
      severity: 'critical',
      title: 'Backup failed',
      message: 'Nightly backup failed.',
      deduplicationKey: 't16-provider-failure',
    });
    expect(created).toHaveLength(1);
    expect(stored).toHaveLength(1);
    expect(stored[0].emailDeliveryStatus).toBe('failed');
    expect(stored[0].emailLastError).toContain('SendGrid down');
  });

  it('17. bounded retry works with max 3 attempts', async () => {
    const durableJobs = { register: jest.fn(), schedule: jest.fn().mockResolvedValue({}) };
    const { service, mailService, stored } = setup(
      { emailEnabled: true, privacyMode: false },
      { durableJobs },
    );
    mailService.sendEmail.mockRejectedValue(new Error('SendGrid down'));
    await service.createForPlatform({
      eventType: 'backup.failed',
      category: 'system',
      severity: 'warning',
      title: 'Backup failed',
      message: 'Nightly backup failed.',
      deduplicationKey: 't17-retry',
    });
    const row = stored[0];
    expect(row.emailAttemptCount).toBe(1);
    expect(durableJobs.schedule).toHaveBeenCalledTimes(1);
    expect(durableJobs.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'notifications.email_retry' }),
    );
    expect(row.emailRetryAt).toBeInstanceOf(Date);

    await service.retryEmailDelivery(row.id);
    expect(stored[0].emailAttemptCount).toBe(2);
    expect(durableJobs.schedule).toHaveBeenCalledTimes(2);

    await service.retryEmailDelivery(row.id);
    expect(stored[0].emailAttemptCount).toBe(3);
    // Third failure exhausts attempts for the original notification: the
    // operations incident is raised instead of a further retry. (The
    // incident notification's own first email attempt accounts for the extra
    // send/schedule calls below.)
    expect(
      durableJobs.schedule.mock.calls.filter(
        (call: any[]) => call[0].dedupeKey === `email-retry:${row.id}`,
      ),
    ).toHaveLength(2);

    // A fourth retry run is a no-op for the exhausted notification.
    const sendsBefore = mailService.sendEmail.mock.calls.length;
    await service.retryEmailDelivery(row.id);
    expect(stored[0].emailAttemptCount).toBe(3);
    expect(
      mailService.sendEmail.mock.calls.filter(
        (call: any[]) => call[0].subject.includes('Backup failed'),
      ).length,
    ).toBe(3);
    expect(mailService.sendEmail.mock.calls.length).toBe(sendsBefore);
  });

  it('18. email failure creates operations incident after exhaustion', async () => {
    const durableJobs = { register: jest.fn(), schedule: jest.fn().mockResolvedValue({}) };
    const { service, mailService, stored } = setup(
      { emailEnabled: true, privacyMode: false },
      { durableJobs },
    );
    mailService.sendEmail.mockRejectedValue(new Error('SendGrid down'));
    await service.createForPlatform({
      eventType: 'backup.failed',
      category: 'system',
      severity: 'warning',
      title: 'Backup failed',
      message: 'Nightly backup failed.',
      deduplicationKey: 't18-exhaust',
    });
    const row = stored[0];
    await service.retryEmailDelivery(row.id);
    await service.retryEmailDelivery(row.id);
    const incident = stored.find((r) => r.eventType === 'notification.email_failed');
    expect(incident).toBeDefined();
    expect(incident.severity).toBe('warning');
    expect(incident.category).toBe('system');
    // The incident itself goes to super_admins only.
    expect(incident.recipientUserId).toBe('user-owner');
  });

  it('19. template action URLs are absolute and external URLs are rejected', async () => {
    const { service, mailService, stored } = setup({ emailEnabled: true, privacyMode: false });
    await service.createForTenant({
      tenantId: 'tenant-1',
      eventType: 'handoff.created',
      category: 'leads',
      severity: 'warning',
      title: 'Handoff',
      message: 'Handoff message.',
      deduplicationKey: 't19-action-url',
      templateId: 'handoff.created',
      templateContext: {
        leadName: 'Jordan Buyer',
        handoffReason: 'Low confidence',
        summary: 'Asked about pricing.',
        actionPath: '/app/conversations?leadId=lead-1',
      },
    });
    const call = mailService.sendEmail.mock.calls[0][0];
    expect(call.text).toContain('https://www.realtytechai.app/app/conversations?leadId=lead-1');
    expect(call.text).not.toMatch(/(^|\s)\/app\//);

    // An external actionPath in the template context must not produce an email.
    const evil = setup({ emailEnabled: true, privacyMode: false });
    const created = await evil.service.createForPlatform({
      eventType: 'system.evil',
      category: 'system',
      severity: 'warning',
      title: 'Evil',
      message: 'Evil message.',
      deduplicationKey: 't19-evil',
      templateId: 'platform.warning',
      templateContext: { warningTitle: 'x', actionPath: 'https://evil.example/phish' },
    });
    expect(created).toEqual([]);
    expect(evil.mailService.sendEmail).not.toHaveBeenCalled();
    expect(evil.stored).toHaveLength(0);
  });

  it('stores template id on the notification for audit', async () => {
    const { service, stored } = setup({ emailEnabled: true, privacyMode: false });
    await service.createForPlatform({
      eventType: 'integration.recovered',
      category: 'integrations',
      severity: 'success',
      title: '',
      message: '',
      deduplicationKey: 't-template-audit',
      templateId: 'integration.recovered',
      templateContext: { provider: 'SendGrid', downtimeMinutes: 17 },
    });
    expect(stored[0].templateId).toBe('integration.recovered');
    expect(stored[0].title).toContain('SendGrid');
  });
});
