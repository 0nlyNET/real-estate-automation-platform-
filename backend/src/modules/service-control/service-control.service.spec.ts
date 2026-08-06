import { BadRequestException } from '@nestjs/common';
import { OnboardingRecord } from '../onboarding/onboarding-record.entity';
import { OperationsTask } from '../operations/operations-task.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Tenant } from '../tenants/tenant.entity';
import { ServiceControlService } from './service-control.service';

function harness(overrides: Partial<Tenant> = {}) {
  const tenant = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Example Realty',
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
  const manager = {
    getRepository: jest.fn().mockImplementation((entity) => {
      if (entity === Tenant) return tenantRepo;
      if (entity === TenantSettings) return settingsRepo;
      if (entity === OnboardingRecord) return onboardingRepo;
      if (entity === OperationsTask) return taskRepo;
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
  const tenants = {
    findOne: jest.fn().mockImplementation(async () => tenant),
    createQueryBuilder: jest.fn(),
  };
  const service = new ServiceControlService(
    dataSource as any,
    tenants as any,
    notifications as any,
    audit as any,
  );
  return {
    service,
    tenant,
    settings,
    manager,
    notifications,
    audit,
    tenantRepo,
    settingsRepo,
    taskRepo,
  };
}

describe('client service control', () => {
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
