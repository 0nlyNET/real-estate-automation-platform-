import { BadRequestException } from '@nestjs/common';
import { OffboardingRequest } from '../offboarding/offboarding-request.entity';
import { OnboardingRecord } from '../onboarding/onboarding-record.entity';
import { OperationsTask } from '../operations/operations-task.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Tenant } from '../tenants/tenant.entity';
import { ServiceControlService } from './service-control.service';

function harness(overrides: Partial<Tenant> = {}) {
  const tenant = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Example Realty',
    paymentConfirmedAt: new Date(),
    paidSubscriptionId: 'sub_paid',
    stripeSubscriptionId: 'sub_paid',
    status: 'active',
    lifecycleStatus: 'ACTIVE',
    ...overrides,
  } as Tenant;
  const settings = { tenantId: tenant.id, automationsEnabled: true } as TenantSettings;
  const tenantRepo = {
    findOne: jest.fn().mockImplementation(async () => tenant),
    save: jest.fn().mockImplementation(async (value) => value),
  };
  const settingsRepo = {
    findOne: jest.fn().mockImplementation(async () => settings),
    create: jest.fn().mockImplementation((value) => value),
    save: jest.fn().mockImplementation(async (value) => value),
  };
  const onboardingRepo = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
  const taskRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation((value) => value),
    save: jest.fn().mockImplementation(async (value) => value),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const offboardingFindOne = jest.fn().mockResolvedValue(null);
  const offboardingRepo = { findOne: offboardingFindOne };
  const manager = {
    getRepository: jest.fn().mockImplementation((entity) => {
      if (entity === Tenant) return tenantRepo;
      if (entity === TenantSettings) return settingsRepo;
      if (entity === OnboardingRecord) return onboardingRepo;
      if (entity === OperationsTask) return taskRepo;
      if (entity === OffboardingRequest) return offboardingRepo;
      throw new Error(`Unexpected repository ${String(entity)}`);
    }),
    query: jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE sequence_enrollments') && sql.includes("status = 'stopped'")) {
        return [{ id: 'enrollment-1' }];
      }
      if (sql.includes('UPDATE sequence_enrollments enrollment')) {
        return [{ id: 'enrollment-1' }];
      }
      if (sql.includes('UPDATE messages')) return [{ id: 'message-1' }];
      return [];
    }),
  };
  const dataSource = {
    transaction: jest.fn().mockImplementation(async (work) => work(manager)),
  };
  const notifications = {
    createForPlatform: jest.fn().mockResolvedValue([]),
    createForTenant: jest.fn().mockResolvedValue([]),
  };
  const audit = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const operationalEvents = {
    billingEvent: jest.fn().mockResolvedValue({ skipped: false }),
    automationResumed: jest.fn().mockResolvedValue({ skipped: false }),
    automationPaused: jest.fn().mockResolvedValue({ skipped: false }),
    readyForActivation: jest.fn().mockResolvedValue({ skipped: false }),
    onboardingBlocked: jest.fn().mockResolvedValue({ skipped: false }),
    integrationFailed: jest.fn().mockResolvedValue({ skipped: false }),
  };
  const tenants = {
    findOne: jest.fn().mockImplementation(async () => tenant),
    createQueryBuilder: jest.fn(),
  };
  const service = new ServiceControlService(
    dataSource as any,
    tenants as any,
    notifications as any,
    audit as any,
    operationalEvents as any,
  );
  return {
    service,
    tenant,
    settings,
    manager,
    notifications,
    audit,
    operationalEvents,
    tenantRepo,
    settingsRepo,
    taskRepo,
    offboardingFindOne,
  };
}

describe('service-control operational event wiring (P1)', () => {
  it('billing suspension raises a billing suspended event', async () => {
    const { service, operationalEvents, tenant } = harness({ lifecycleStatus: 'ACTIVE' });
    const result = await service.suspend({
      tenantId: tenant.id,
      reason: 'Payment failed',
      source: 'billing',
    });
    expect(result.changed).toBe(true);
    expect(operationalEvents.billingEvent).toHaveBeenCalledTimes(1);
    expect(operationalEvents.billingEvent).toHaveBeenCalledWith({
      tenantId: tenant.id,
      tenantName: tenant.name,
      type: 'suspended',
      detail: 'Payment failed',
    });
  });

  it('manual suspension does not raise a billing event', async () => {
    const { service, operationalEvents, tenant } = harness({ lifecycleStatus: 'ACTIVE' });
    const result = await service.suspend({
      tenantId: tenant.id,
      reason: 'Owner requested pause',
      source: 'manual',
    });
    expect(result.changed).toBe(true);
    expect(operationalEvents.billingEvent).not.toHaveBeenCalled();
  });

  it('billing restore raises recovered and automation-resumed events', async () => {
    const { service, operationalEvents, tenant } = harness({
      lifecycleStatus: 'SUSPENDED',
      serviceSuspensionSource: 'billing',
      servicePreviousLifecycleStatus: 'ACTIVE',
      paymentConfirmedAt: new Date(),
      paidSubscriptionId: 'sub_paid',
      stripeSubscriptionId: 'sub_paid',
    });
    const result = await service.restore({
      tenantId: tenant.id,
      actor: { id: 'operator-1', role: 'super_admin', email: 'owner@example.com' } as any,
      billingRecoveryOnly: true,
    });
    expect(result.changed).toBe(true);
    expect(operationalEvents.billingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: tenant.id, type: 'recovered' }),
    );
    expect(operationalEvents.automationResumed).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: tenant.id }),
    );
  });

  it('restore still succeeds when the notification facade throws', async () => {
    const { service, operationalEvents, tenant } = harness({
      lifecycleStatus: 'SUSPENDED',
      serviceSuspensionSource: 'billing',
      servicePreviousLifecycleStatus: 'ACTIVE',
      paymentConfirmedAt: new Date(),
      paidSubscriptionId: 'sub_paid',
      stripeSubscriptionId: 'sub_paid',
    });
    operationalEvents.billingEvent.mockRejectedValue(new Error('notify down'));
    operationalEvents.automationResumed.mockRejectedValue(new Error('notify down'));
    const result = await service.restore({
      tenantId: tenant.id,
      actor: { id: 'operator-1', role: 'super_admin', email: 'owner@example.com' } as any,
      billingRecoveryOnly: true,
    });
    expect(result.changed).toBe(true);
  });
});

describe('client service control', () => {
  it('automatically restores only billing suspensions after verified payment', async () => {
    const billing = harness({ lifecycleStatus: 'SUSPENDED', serviceSuspensionSource: 'billing', servicePreviousLifecycleStatus: 'ACTIVE' });
    await expect(billing.service.restoreAfterPayment(billing.tenant.id)).resolves.toMatchObject({ changed: true, lifecycleStatus: 'ACTIVE' });
    expect(billing.settings.automationsEnabled).toBe(true);
    for (const source of ['manual', 'safety'] as const) {
      const h = harness({ lifecycleStatus: 'SUSPENDED', serviceSuspensionSource: source, servicePreviousLifecycleStatus: 'ACTIVE' });
      await expect(h.service.restoreAfterPayment(h.tenant.id)).resolves.toMatchObject({ changed: false, lifecycleStatus: 'SUSPENDED' });
    }
  });
  it('suspends every automation path while preserving the workspace', async () => {
    const setup = harness();
    const result = await setup.service.suspend({
      tenantId: setup.tenant.id,
      source: 'manual',
      reason: 'Payment was not received.',
      internalNote: 'Owner confirmed the suspension.',
      requestCorrelationId: 'request-123',
      actor: {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'owner@example.com',
      },
    });

    expect(result).toMatchObject({
      changed: true,
      clientId: setup.tenant.id,
      previousState: 'ACTIVE',
      lifecycleStatus: 'SUSPENDED',
      stoppedEnrollments: 1,
      blockedMessages: 1,
      canceledMessages: 1,
    });
    expect(setup.tenant.lifecycleStatus).toBe('SUSPENDED');
    expect(setup.tenant.servicePreviousLifecycleStatus).toBe('ACTIVE');
    expect(setup.settings.automationsEnabled).toBe(false);
    expect(setup.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE sequence_enrollments'),
      [setup.tenant.id],
    );
    expect(setup.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE messages'),
      [setup.tenant.id],
    );
    const suspensionSql = setup.manager.query.mock.calls
      .map(([sql]) => String(sql))
      .join('\n');
    expect(suspensionSql).toContain(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
    );
    expect(suspensionSql).toContain('provider_submission_started_at IS NULL');
    expect(suspensionSql).toContain(
      "status IN ('created', 'queued', 'pending', 'scheduled', 'sending')",
    );
    expect(suspensionSql).toContain(
      'SELECT id FROM leads WHERE tenant_id = $1',
    );
    expect(suspensionSql).not.toContain('DELETE FROM');
    expect(setup.notifications.createForPlatform).toHaveBeenCalledTimes(1);
    expect(setup.notifications.createForTenant).toHaveBeenCalledTimes(1);
    expect(setup.taskRepo.save).toHaveBeenCalledTimes(1);
    expect(setup.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: setup.tenant.id,
        action: 'client.services.suspended',
        metadata: expect.objectContaining({
          stoppedEnrollments: 1,
          blockedMessages: 1,
          canceledMessages: 1,
          previousState: 'ACTIVE',
          newState: 'SUSPENDED',
          requestCorrelationId: 'request-123',
          internalNote: 'Owner confirmed the suspension.',
        }),
      }),
      setup.manager,
    );
  });

  it('is idempotent when the same workspace is suspended again', async () => {
    const setup = harness({
      lifecycleStatus: 'SUSPENDED',
      serviceSuspendedAt: new Date('2026-07-23T00:00:00Z'),
      serviceSuspensionReason: 'Payment was not received.',
      serviceSuspensionSource: 'billing',
    });
    const result = await setup.service.suspend({
      tenantId: setup.tenant.id,
      source: 'billing',
      reason: 'Payment was not received.',
    });

    expect(result.changed).toBe(false);
    expect(result.stoppedEnrollments).toBe(0);
    expect(result.canceledMessages).toBe(0);
    expect(setup.audit.record).not.toHaveBeenCalled();
    expect(setup.taskRepo.save).not.toHaveBeenCalled();
    expect(setup.notifications.createForPlatform).toHaveBeenCalledWith(
      expect.objectContaining({
        deduplicationKey: `service-suspended:${setup.tenant.id}:2026-07-23T00:00:00.000Z`,
      }),
    );
  });

  it('does not duplicate the open task or audit event across repeated suspension calls', async () => {
    const setup = harness();
    const input = {
      tenantId: setup.tenant.id,
      source: 'manual' as const,
      reason: 'Payment was not received.',
      actor: { id: '22222222-2222-4222-8222-222222222222' },
    };

    await setup.service.suspend(input);
    await setup.service.suspend(input);

    expect(setup.taskRepo.save).toHaveBeenCalledTimes(1);
    expect(setup.audit.record).toHaveBeenCalledTimes(1);
    const platformCalls = setup.notifications.createForPlatform.mock.calls;
    expect(platformCalls).toHaveLength(2);
    expect(platformCalls[0][0].deduplicationKey).toBe(
      platformCalls[1][0].deduplicationKey,
    );
  });

  it('restores an active paid workspace and only its suspension-stopped enrollments', async () => {
    const setup = harness({
      status: 'active',
      lifecycleStatus: 'SUSPENDED',
      servicePreviousLifecycleStatus: 'ACTIVE',
      serviceSuspendedAt: new Date('2026-07-23T00:00:00Z'),
      serviceSuspensionReason: 'Payment was not received.',
      serviceSuspensionSource: 'billing',
    });
    const result = await setup.service.restore({
      tenantId: setup.tenant.id,
      actor: {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'owner@example.com',
      },
    });

    expect(result).toMatchObject({
      changed: true,
      lifecycleStatus: 'ACTIVE',
      restoredEnrollments: 1,
    });
    expect(setup.settings.automationsEnabled).toBe(true);
    expect(setup.tenant.serviceSuspensionReason).toBe('Payment was not received.');
    expect(setup.tenant.serviceSuspensionSource).toBe('billing');
    expect(setup.manager.query).toHaveBeenCalledWith(
      expect.stringContaining("stopped_reason = 'service_suspended'"),
      [setup.tenant.id],
    );
    expect(setup.taskRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'service_suspension',
        relatedEntityId: setup.tenant.id,
      }),
      expect.objectContaining({ status: 'resolved' }),
    );
  });

  it('refuses to restore services before Stripe confirms payment', async () => {
    const setup = harness({
      status: 'past_due',
      lifecycleStatus: 'SUSPENDED',
      servicePreviousLifecycleStatus: 'ACTIVE',
      serviceSuspendedAt: new Date('2026-07-23T00:00:00Z'),
    });

    await expect(
      setup.service.restore({
        tenantId: setup.tenant.id,
        actor: { id: '22222222-2222-4222-8222-222222222222' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(setup.settings.automationsEnabled).toBe(true);
  });

  it('does not notify or audit when restore is repeated after service is already active', async () => {
    const restoredAt = new Date('2026-07-23T01:00:00Z');
    const setup = harness({
      status: 'active',
      lifecycleStatus: 'ACTIVE',
      serviceRestoredAt: restoredAt,
    });

    await expect(
      setup.service.restore({
        tenantId: setup.tenant.id,
        actor: { id: '22222222-2222-4222-8222-222222222222' },
      }),
    ).resolves.toMatchObject({
      changed: false,
      restoredAt,
      restoredEnrollments: 0,
    });
    expect(setup.notifications.createForPlatform).not.toHaveBeenCalled();
    expect(setup.notifications.createForTenant).not.toHaveBeenCalled();
    expect(setup.audit.record).not.toHaveBeenCalled();
  });
});

describe('billing recovery terminal-state gates (P7)', () => {
  // "Pay" = the conditions that trigger restoreAfterPayment: Stripe-confirmed
  // active billing (the harness default) plus a SUSPENDED workspace.
  const suspendedTenant = (overrides: Record<string, unknown> = {}) =>
    harness({
      status: 'active',
      lifecycleStatus: 'SUSPENDED',
      serviceSuspendedAt: new Date('2026-07-23T00:00:00Z'),
      serviceSuspensionSource: 'billing',
      servicePreviousLifecycleStatus: 'ACTIVE',
      ...overrides,
    });

  it('(1) billing suspend -> pay -> restores', async () => {
    const setup = suspendedTenant();
    await expect(setup.service.restoreAfterPayment(setup.tenant.id)).resolves.toMatchObject({
      changed: true,
      lifecycleStatus: 'ACTIVE',
    });
    expect(setup.tenant.serviceSuspensionSource).toBe('billing');
  });

  it('(2) manual suspend -> pay -> stays suspended', async () => {
    const setup = suspendedTenant({ serviceSuspensionSource: 'manual' });
    await expect(setup.service.restoreAfterPayment(setup.tenant.id)).resolves.toMatchObject({
      changed: false,
      lifecycleStatus: 'SUSPENDED',
    });
  });

  it('(3) safety suspend -> pay -> stays suspended', async () => {
    const setup = suspendedTenant({ serviceSuspensionSource: 'safety' });
    await expect(setup.service.restoreAfterPayment(setup.tenant.id)).resolves.toMatchObject({
      changed: false,
      lifecycleStatus: 'SUSPENDED',
    });
  });

  it('(4a) offboarding in progress -> pay -> stays offboarding (offboarding record gate)', async () => {
    const setup = suspendedTenant({ serviceSuspensionSource: 'billing' });
    setup.offboardingFindOne.mockResolvedValue({
      tenantId: setup.tenant.id,
      status: 'retention',
      deleteAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    await expect(setup.service.restoreAfterPayment(setup.tenant.id)).resolves.toMatchObject({
      changed: false,
      lifecycleStatus: 'SUSPENDED',
    });
    expect(setup.notifications.createForTenant).not.toHaveBeenCalled();
  });

  it('(4b) offboarding in progress -> pay -> stays offboarding (terminal source marker)', async () => {
    // Post-fix offboarding.start() state: distinct terminal marker + no
    // previous-lifecycle restore target.
    const setup = suspendedTenant({
      serviceSuspensionSource: 'offboarding',
      servicePreviousLifecycleStatus: null,
    });
    await expect(setup.service.restoreAfterPayment(setup.tenant.id)).resolves.toMatchObject({
      changed: false,
      lifecycleStatus: 'SUSPENDED',
    });
  });

  it('(4c) manual restore is also refused while offboarding is in progress', async () => {
    const setup = suspendedTenant({
      serviceSuspensionSource: 'offboarding',
      servicePreviousLifecycleStatus: null,
    });
    await expect(
      setup.service.restore({
        tenantId: setup.tenant.id,
        actor: { id: '22222222-2222-4222-8222-222222222222' },
      }),
    ).resolves.toMatchObject({ changed: false, lifecycleStatus: 'SUSPENDED' });
  });

  it('(5) canceled -> pay -> stays canceled', async () => {
    const setup = suspendedTenant({ lifecycleStatus: 'CANCELED' });
    await expect(setup.service.restoreAfterPayment(setup.tenant.id)).resolves.toMatchObject({
      changed: false,
      lifecycleStatus: 'CANCELED',
    });
  });
});
