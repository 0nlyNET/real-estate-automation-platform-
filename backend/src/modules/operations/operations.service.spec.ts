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
