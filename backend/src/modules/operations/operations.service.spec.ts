import { randomUUID } from 'crypto';
import { DataType, newDb } from 'pg-mem';
import { OperationsTask } from './operations-task.entity';
import { OperationsService } from './operations.service';

describe('OperationsService queue ordering and filters', () => {
  it('applies tenant/priority/overdue filters and returns critical work first', async () => {
    const now = Date.now();
    const rows: any[] = [
      {
        id: 'normal',
        priority: 'normal',
        dueAt: new Date(now - 60_000),
        createdAt: new Date(now - 60_000),
      },
      {
        id: 'critical',
        priority: 'critical',
        dueAt: null,
        createdAt: new Date(now),
      },
      {
        id: 'high',
        priority: 'high',
        dueAt: new Date(now + 60_000),
        createdAt: new Date(now),
      },
    ];
    const repo = { find: jest.fn().mockResolvedValue(rows) };
    const service = new OperationsService(repo as any);

    await expect(
      service.list({
        tenantId: 'tenant-a',
        priority: 'high',
        overdue: true,
        take: 2,
        skip: 0,
      }),
    ).resolves.toEqual([rows[1], rows[2]]);
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-a',
          priority: 'high',
          status: 'open',
          dueAt: expect.any(Object),
        }),
      }),
    );
  });

  it('validates an assignee and creates one trusted assignment notification', async () => {
    const repo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({
        id: 'task-1',
        createdAt: new Date(),
        ...value,
      })),
    };
    const notifications = {
      createForPlatform: jest.fn().mockResolvedValue([]),
    };
    const operators = {
      requireAssignable: jest.fn().mockResolvedValue({ id: 'staff-1' }),
    };
    const service = new OperationsService(
      repo as any,
      notifications as any,
      operators as any,
    );

    await service.createTask({
      title: 'Review onboarding',
      description: 'Confirm the client intake.',
      category: 'onboarding',
      assignedOperatorId: 'staff-1',
    });

    expect(operators.requireAssignable).toHaveBeenCalledWith('staff-1');
    expect(notifications.createForPlatform).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'task.assigned',
        assignedOperatorId: 'staff-1',
        deduplicationKey: 'operations-task:task-1:staff-1',
      }),
    );
  });

  it('automatically resolves a recovered incident and preserves recovery evidence', async () => {
    const task: any = {
      id: 'task-1',
      tenantId: 'tenant-1',
      category: 'provider_configuration',
      relatedEntityType: 'tenant',
      relatedEntityId: 'tenant-1',
      status: 'open',
      completedAt: null,
      evidenceNote: null,
    };
    const repo = {
      find: jest.fn().mockResolvedValue([task]),
      save: jest.fn(async (value) => value),
    };
    const service = new OperationsService(repo as any);

    await expect(
      service.resolveRecoverableTasks({
        tenantId: 'tenant-1',
        category: 'provider_configuration',
        relatedEntityType: 'tenant',
        relatedEntityId: 'tenant-1',
        evidenceNote: 'Provider reconciliation completed automatically.',
      }),
    ).resolves.toBe(1);
    expect(task).toMatchObject({
      status: 'resolved',
      evidenceNote: 'Provider reconciliation completed automatically.',
    });
    expect(task.completedAt).toBeInstanceOf(Date);
  });

  it('builds a bounded exception query without a raw dotted CASE order expression', async () => {
    const builder: any = {};
    for (const method of ['addSelect', 'where', 'addOrderBy', 'take']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.orderBy = jest.fn((expression: string) => {
      if (expression.includes('CASE') && expression.includes('.')) {
        throw new Error('TypeORM interpreted a raw CASE property as an alias');
      }
      return builder;
    });
    builder.getMany = jest.fn().mockResolvedValue([]);
    const repo = { createQueryBuilder: jest.fn(() => builder) };
    const jobs = { find: jest.fn().mockResolvedValue([]) };
    const service = new OperationsService(
      repo as any,
      undefined,
      undefined,
      jobs as any,
    );

    await expect(service.exceptionSummary()).resolves.toEqual({
      status: 'HEALTHY',
      action: 'NO ACTION',
      exceptions: [],
    });
    expect(builder.addSelect).toHaveBeenCalledWith(
      expect.stringContaining('CASE task.priority'),
      'priority_rank',
    );
    expect(builder.orderBy).toHaveBeenCalledWith('priority_rank', 'DESC');
    expect(builder.take).toHaveBeenCalledWith(201);
    expect(jobs.find).toHaveBeenCalledWith(
      expect.objectContaining({ take: 201 }),
    );
  });

  it('executes the repaired exception ordering through a real TypeORM query builder', async () => {
    const database = newDb();
    database.public.registerFunction({
      name: 'current_database',
      returns: DataType.text,
      implementation: () => 'operations_test',
    });
    database.public.registerFunction({
      name: 'version',
      returns: DataType.text,
      implementation: () => 'PostgreSQL 16.0',
    });
    database.public.registerFunction({
      name: 'uuid_generate_v4',
      returns: DataType.uuid,
      impure: true,
      implementation: randomUUID,
    });
    const dataSource = database.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [OperationsTask],
      synchronize: true,
    });
    await dataSource.initialize();
    try {
      const repo = dataSource.getRepository(OperationsTask);
      await repo.save([
        repo.create({
          category: 'routine_check',
          title: 'Routine check',
          description: 'Routine exception',
          priority: 'normal',
          status: 'open',
        }),
        repo.create({
          category: 'provider_outage',
          title: 'Provider outage',
          description: 'Critical exception',
          priority: 'critical',
          status: 'blocked',
        }),
      ]);
      const service = new OperationsService(repo);

      const result = await service.exceptionSummary();

      expect(result.exceptions.map((item) => item.category)).toEqual([
        'provider_outage',
        'routine_check',
      ]);
    } finally {
      await dataSource.destroy();
    }
  });
});

describe('OperationsService follow-up alert dedup and throttle', () => {
  const LEAD_1 = randomUUID();
  const LEAD_2 = randomUUID();
  const TENANT_1 = randomUUID();

  async function buildService() {
    const database = newDb();
    database.public.registerFunction({
      name: 'current_database',
      returns: DataType.text,
      implementation: () => 'operations_dedup_test',
    });
    database.public.registerFunction({
      name: 'version',
      returns: DataType.text,
      implementation: () => 'PostgreSQL 16.0',
    });
    database.public.registerFunction({
      name: 'uuid_generate_v4',
      returns: DataType.uuid,
      impure: true,
      implementation: randomUUID,
    });
    const dataSource = database.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [OperationsTask],
      synchronize: true,
    });
    await dataSource.initialize();
    const repo = dataSource.getRepository(OperationsTask);
    const service = new OperationsService(repo);
    return { dataSource, repo, service };
  }

  const followUpInput = (leadId: string) => ({
    tenantId: TENANT_1,
    category: 'ai_provider_failure',
    title: 'AI processing needs human follow-up',
    description: 'AI processing was interrupted repeatedly.',
    priority: 'high' as const,
    relatedEntityType: 'lead',
    relatedEntityId: leadId,
    dedupeOpen: true,
    throttleHours: 24,
  });

  it('creates one row when the same alert fires twice while the first is open', async () => {
    const { dataSource, repo, service } = await buildService();
    try {
      const first = await service.createTask(followUpInput(LEAD_1));
      const second = await service.createTask(followUpInput(LEAD_1));
      expect(second.id).toBe(first.id);
      expect(await repo.count()).toBe(1);
    } finally {
      await dataSource.destroy();
    }
  });

  it('treats in_progress tasks as unresolved for dedup', async () => {
    const { dataSource, repo, service } = await buildService();
    try {
      const first = await service.createTask(followUpInput(LEAD_1));
      await service.updateTask(first.id, { status: 'in_progress' });
      const second = await service.createTask(followUpInput(LEAD_1));
      expect(second.id).toBe(first.id);
      expect(await repo.count()).toBe(1);
    } finally {
      await dataSource.destroy();
    }
  });

  it('throttle blocks rapid re-creation even after the first alert is resolved', async () => {
    const { dataSource, repo, service } = await buildService();
    try {
      const first = await service.createTask(followUpInput(LEAD_1));
      await service.updateTask(first.id, { status: 'resolved' });
      const second = await service.createTask(followUpInput(LEAD_1));
      expect(second.id).toBe(first.id);
      expect(await repo.count()).toBe(1);
    } finally {
      await dataSource.destroy();
    }
  });

  it('allows a new alert after resolution when no throttle window applies', async () => {
    const { dataSource, repo, service } = await buildService();
    try {
      const input = { ...followUpInput(LEAD_1) };
      delete (input as any).throttleHours;
      const first = await service.createTask(input);
      await service.updateTask(first.id, { status: 'resolved' });
      const second = await service.createTask(input);
      expect(second.id).not.toBe(first.id);
      expect(await repo.count()).toBe(2);
    } finally {
      await dataSource.destroy();
    }
  });

  it('dedupes per subject, not globally', async () => {
    const { dataSource, repo, service } = await buildService();
    try {
      await service.createTask(followUpInput(LEAD_1));
      await service.createTask(followUpInput(LEAD_2));
      expect(await repo.count()).toBe(2);
    } finally {
      await dataSource.destroy();
    }
  });

  it('collapses concurrent duplicate alerts for the same subject into one task', async () => {
    // Regression: overlapping worker ticks raced the check-then-insert
    // sequence and created one operations task (and one notification) per
    // duplicate during the 2026-09-26 rehearsal.
    const { dataSource, repo, service } = await buildService();
    try {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => service.createTask(followUpInput(LEAD_1))),
      );
      const ids = new Set(results.map((task) => task.id));
      expect(ids.size).toBe(1);
      expect(await repo.count()).toBe(1);
    } finally {
      await dataSource.destroy();
    }
  });

  it('emits exactly one platform notification for a concurrent duplicate burst', async () => {
    const database = newDb();
    database.public.registerFunction({
      name: 'current_database',
      returns: DataType.text,
      implementation: () => 'operations_notify_test',
    });
    database.public.registerFunction({
      name: 'version',
      returns: DataType.text,
      implementation: () => 'PostgreSQL 16.0',
    });
    database.public.registerFunction({
      name: 'uuid_generate_v4',
      returns: DataType.uuid,
      impure: true,
      implementation: randomUUID,
    });
    const dataSource = database.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [OperationsTask],
      synchronize: true,
    });
    await dataSource.initialize();
    try {
      const repo = dataSource.getRepository(OperationsTask);
      const notifications = { createForPlatform: jest.fn().mockResolvedValue({}) };
      const service = new OperationsService(repo, notifications as any);
      await Promise.all(
        Array.from({ length: 10 }, () => service.createTask(followUpInput(LEAD_1))),
      );
      expect(await repo.count()).toBe(1);
      expect(notifications.createForPlatform).toHaveBeenCalledTimes(1);
    } finally {
      await dataSource.destroy();
    }
  });

  it('does not serialize alerts for different subjects', async () => {
    const { dataSource, repo, service } = await buildService();
    try {
      const results = await Promise.all([
        service.createTask(followUpInput(LEAD_1)),
        service.createTask(followUpInput(LEAD_2)),
      ]);
      expect(results[0].id).not.toBe(results[1].id);
      expect(await repo.count()).toBe(2);
    } finally {
      await dataSource.destroy();
    }
  });

  it('collapses 100 exhausted-run alerts for one lead into one task and one notification', async () => {
    // Incident regression (2026-09-27): the runaway recovery loop fired one
    // alert per worker tick. With a valid lead dedupe key, 100 sequential
    // alerts must produce exactly one open task and one notification.
    const database = newDb();
    database.public.registerFunction({
      name: 'current_database',
      returns: DataType.text,
      implementation: () => 'operations_100_test',
    });
    database.public.registerFunction({
      name: 'version',
      returns: DataType.text,
      implementation: () => 'PostgreSQL 16.0',
    });
    database.public.registerFunction({
      name: 'uuid_generate_v4',
      returns: DataType.uuid,
      impure: true,
      implementation: randomUUID,
    });
    const dataSource = database.adapters.createTypeormDataSource({
      type: 'postgres',
      entities: [OperationsTask],
      synchronize: true,
    });
    await dataSource.initialize();
    try {
      const repo = dataSource.getRepository(OperationsTask);
      const notifications = { createForPlatform: jest.fn().mockResolvedValue({}) };
      const service = new OperationsService(repo, notifications as any);
      for (let i = 0; i < 100; i++) {
        await service.createTask(followUpInput(LEAD_1));
      }
      expect(await repo.count()).toBe(1);
      const task = await repo.findOne({ where: {} });
      expect(task?.status).toBe('open');
      expect(task?.relatedEntityId).toBe(LEAD_1);
      expect(notifications.createForPlatform).toHaveBeenCalledTimes(1);
    } finally {
      await dataSource.destroy();
    }
  });

  it('recovers from a lost cross-process dedupe race via the unique index', async () => {
    // The in-process lock cannot serialize workers in different processes.
    // When a future partial unique index rejects the second insert (23505),
    // the service must return the existing task instead of erroring.
    // (Index deferred until after 2026-09-27 incident evidence is preserved;
    // this test guards the defensive 23505 handler.)
    const { dataSource, repo, service } = await buildService();
    try {
      const first = await service.createTask(followUpInput(LEAD_1));
      // Simulate the race window: the dedupe and throttle checks run
      // before the other process's insert is visible, so both miss; the
      // insert then hits the unique index. The recovery lookup sees it.
      const findOne = jest.spyOn(repo, 'findOne');
      findOne.mockResolvedValueOnce(null as any);
      findOne.mockResolvedValueOnce(null as any);
      findOne.mockImplementation(async () => first as any);
      const save = jest.spyOn(repo, 'save');
      save.mockImplementationOnce(async () => {
        const error: any = new Error(
          'duplicate key value violates unique constraint "uq_operations_tasks_open_dedupe"',
        );
        error.code = '23505';
        throw error;
      });
      // Bypass the in-process lock to simulate a second process racing in.
      const second = await (service as any).findOrInsertTask(
        followUpInput(LEAD_1),
      );
      expect(second.created).toBe(false);
      expect(second.task.id).toBe(first.id);
      expect(await repo.count()).toBe(1);
      save.mockRestore();
      findOne.mockRestore();
    } finally {
      await dataSource.destroy();
    }
  });
});
