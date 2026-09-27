import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { OperationsTask } from './operations-task.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformOperatorsService } from '../../common/platform-operators.service';
import { DurableJob } from '../durable-jobs/durable-job.entity';

export type CreateOperationsTask = {
  tenantId?: string | null;
  applicationId?: string | null;
  category: string;
  title: string;
  description: string;
  priority?: OperationsTask['priority'];
  assignedOperatorId?: string | null;
  dueAt?: Date | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  evidenceNote?: string | null;
  dedupeOpen?: boolean;
  /**
   * When set, at most one task per (category, relatedEntityType, relatedEntityId)
   * is created within the trailing window of this many hours — even when the
   * previous task was already resolved. Guards recurring triggers that would
   * otherwise flood the queue after each resolution.
   */
  throttleHours?: number;
};

@Injectable()
export class OperationsService {
  /**
   * In-process promise chains keyed by dedupe tuple. Makes the
   * check-then-insert sequence in createTask atomic within this process, so
   * concurrent callers (e.g. overlapping worker ticks) cannot both observe
   * "no existing task" and insert duplicates.
   */
  private readonly dedupeChains = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(OperationsTask)
    private readonly repo: Repository<OperationsTask>,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly platformOperators?: PlatformOperatorsService,
    @Optional()
    @InjectRepository(DurableJob)
    private readonly jobs?: Repository<DurableJob>,
  ) {}

  private async withDedupeLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.dedupeChains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.dedupeChains.set(key, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      // Drop the entry once this holder finishes, but only when it is still
      // the tail, so the map cannot grow without bound.
      void gate.then(() => {
        if (this.dedupeChains.get(key) === tail) {
          this.dedupeChains.delete(key);
        }
      });
    }
  }

  async createTask(input: CreateOperationsTask) {
    // Serialize the check-then-insert sequence per dedupe tuple so
    // concurrent callers collapse onto one task instead of racing.
    const dedupeKey =
      (input.dedupeOpen || (input.throttleHours && input.throttleHours > 0)) &&
      input.relatedEntityType &&
      input.relatedEntityId
        ? `task-dedupe:${input.category}:${input.relatedEntityType}:${input.relatedEntityId}`
        : null;
    const saved = dedupeKey
      ? await this.withDedupeLock(dedupeKey, () => this.findOrInsertTask(input))
      : await this.findOrInsertTask(input);
    // Notify only for newly created tasks: dedupe/throttle hits reuse the
    // existing task and must not re-fire its notification.
    if (
      saved.created &&
      (saved.task.priority === 'high' ||
        saved.task.priority === 'critical' ||
        saved.task.assignedOperatorId)
    ) {
      const task = saved.task;
      await this.notifications?.createForPlatform({
        eventType: task.assignedOperatorId ? 'task.assigned' : 'task.created',
        category: 'tasks',
        severity: task.priority === 'critical' ? 'critical' : 'warning',
        title: task.assignedOperatorId ? 'Task assigned to you' : task.title,
        message: task.description,
        deduplicationKey: `operations-task:${task.id}:${task.assignedOperatorId || 'queue'}`,
        assignedOperatorId: task.assignedOperatorId,
        actionUrl: '/admin/dashboard?view=tasks',
        entityType: 'operations_task',
        entityId: task.id,
      });
    }
    return saved.task;
  }

  private async findOrInsertTask(
    input: CreateOperationsTask,
  ): Promise<{ task: OperationsTask; created: boolean }> {
    const unresolvedStatuses: OperationsTask['status'][] = [
      'open',
      'in_progress',
      'blocked',
    ];
    if (input.dedupeOpen && input.relatedEntityType && input.relatedEntityId) {
      const existing = await this.repo.findOne({
        where: {
          category: input.category,
          relatedEntityType: input.relatedEntityType,
          relatedEntityId: input.relatedEntityId,
          status: In(unresolvedStatuses),
        },
        order: { createdAt: 'DESC' },
      });
      if (existing) return { task: existing, created: false };
    }

    // Throttle recurring triggers: at most one task per (category, subject)
    // within the trailing window, even if the previous task was resolved.
    if (
      input.throttleHours &&
      input.throttleHours > 0 &&
      input.relatedEntityType &&
      input.relatedEntityId
    ) {
      const windowStart = new Date(
        Date.now() - input.throttleHours * 3_600_000,
      );
      const recent = await this.repo.findOne({
        where: {
          category: input.category,
          relatedEntityType: input.relatedEntityType,
          relatedEntityId: input.relatedEntityId,
          createdAt: MoreThan(windowStart),
        },
        order: { createdAt: 'DESC' },
      });
      if (recent) return { task: recent, created: false };
    }

    if (input.assignedOperatorId) {
      await this.platformOperators?.requireAssignable(input.assignedOperatorId);
    }
    try {
      const task = await this.repo.save(
        this.repo.create({
          tenantId: input.tenantId ?? null,
          applicationId: input.applicationId ?? null,
          category: input.category,
          title: input.title,
          description: input.description,
          priority: input.priority || 'normal',
          status: 'open',
          assignedOperatorId: input.assignedOperatorId ?? null,
          dueAt: input.dueAt ?? null,
          relatedEntityType: input.relatedEntityType ?? null,
          relatedEntityId: input.relatedEntityId ?? null,
          evidenceNote: input.evidenceNote ?? null,
        }),
      );
      return { task, created: true };
    } catch (error) {
      // Defensive: if a partial unique dedupe index is added in a future
      // migration (deferred until after the 2026-09-27 incident evidence is
      // preserved), a lost cross-process race surfaces as 23505. Return the
      // existing task instead of duplicating or erroring.
      if (
        String((error as any)?.code || '') === '23505' &&
        input.relatedEntityType &&
        input.relatedEntityId
      ) {
        const existing = await this.repo.findOne({
          where: {
            category: input.category,
            relatedEntityType: input.relatedEntityType,
            relatedEntityId: input.relatedEntityId,
            status: In(['open', 'in_progress', 'blocked']),
          },
          order: { createdAt: 'DESC' },
        });
        if (existing) return { task: existing, created: false };
      }
      throw error;
    }
  }

  async list(filters: {
    status?: string;
    category?: string;
    tenantId?: string;
    priority?: string;
    overdue?: boolean;
    take?: number;
    skip?: number;
    includeIncident?: boolean;
  }) {
    const where: FindOptionsWhere<OperationsTask> = {};
    if (filters.status) where.status = filters.status as OperationsTask['status'];
    if (filters.category) where.category = filters.category;
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.priority)
      where.priority = filters.priority as OperationsTask['priority'];
    // Phase 4: collapse the ~100 ai_provider_failure incident tasks from the
    // default view. They remain in the database untouched and are visible via
    // includeIncident=true (Incident history filter).
    if (!filters.includeIncident && !filters.category) {
      where.category = Not('ai_provider_failure');
    }
    if (filters.overdue) {
      where.dueAt = LessThan(new Date());
      if (!filters.status) where.status = 'open';
    }
    const take = Math.min(Math.max(filters.take || 50, 1), 200);
    const skip = Math.max(filters.skip || 0, 0);
    const rows = await this.repo.find({
      where,
      order: { dueAt: 'ASC', createdAt: 'DESC' },
      take: 200,
    });
    const priorityRank: Record<OperationsTask['priority'], number> = {
      critical: 4,
      high: 3,
      normal: 2,
      low: 1,
    };
    return rows
      .sort((a, b) => {
        const byPriority = priorityRank[b.priority] - priorityRank[a.priority];
        if (byPriority) return byPriority;
        const aDue = a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bDue = b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (aDue !== bDue) return aDue - bDue;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(skip, skip + take);
  }

  async exceptionSummary() {
    // TypeORM treats dotted property paths inside a raw ORDER BY expression as
    // entity aliases. Ordering directly by a raw CASE expression therefore
    // throws before PostgreSQL is queried. Select the rank under a plain alias.
    const taskQuery = this.repo
      .createQueryBuilder('task')
      .addSelect(
        "CASE task.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END",
        'priority_rank',
      )
      .where('task.status IN (:...activeStatuses)', {
        activeStatuses: ['open', 'in_progress', 'blocked'],
      })
      .orderBy('priority_rank', 'DESC')
      .addOrderBy('task.createdAt', 'ASC')
      .take(201);
    const [tasks, failedJobs] = await Promise.all([
      taskQuery.getMany(),
      this.jobs
        ? this.jobs.find({
            where: { status: 'failed' },
            order: { updatedAt: 'DESC' },
            take: 201,
          })
        : Promise.resolve([]),
    ]);
    if (!tasks.length && !failedJobs.length) {
      return { status: 'HEALTHY', action: 'NO ACTION', exceptions: [] };
    }
    const tasksTruncated = tasks.length > 200;
    const failedJobsTruncated = failedJobs.length > 200;
    const visibleTasks = tasks.slice(0, 200);
    const visibleFailedJobs = failedJobs.slice(0, 200);
    const tenantIds = [...new Set(visibleTasks.map((task) => task.tenantId).filter(Boolean))] as string[];
    const jobs = tenantIds.length && this.jobs
      ? await this.jobs.find({
          where: { tenantId: In(tenantIds) },
          order: { updatedAt: 'DESC' },
          take: 500,
        })
      : [];
    const taskExceptions = visibleTasks.map((task) => {
      const attempts = jobs
        .filter((job) => job.tenantId === task.tenantId && job.attemptCount > 0)
        .slice(0, 10)
        .map((job) => ({
          operation: job.taskType,
          attempts: job.attemptCount,
          maxAttempts: job.maxAttempts,
          status: job.status,
          lastError: job.lastError,
          lastChecked: job.updatedAt,
        }));
      return {
        id: task.id,
        tenantId: task.tenantId || null,
        severity: task.priority,
        category: task.category,
        problem: task.description,
        providerError: task.evidenceNote || null,
        automaticAttempts: attempts,
        recommendedAction:
          task.evidenceNote || `Review and resolve: ${task.title}`,
        firstDetected: task.createdAt,
        lastChecked: task.updatedAt,
        status: task.status,
      };
    });
    const failedJobExceptions = visibleFailedJobs.map((job) => ({
      id: `job:${job.id}`,
      tenantId: job.tenantId,
      severity: 'critical',
      category: 'durable_job_failure',
      problem: `${job.taskType} exhausted automatic retries`,
      providerError: job.lastError,
      automaticAttempts: [{
        operation: job.taskType,
        attempts: job.attemptCount,
        maxAttempts: job.maxAttempts,
        status: job.status,
        lastError: job.lastError,
        lastChecked: job.updatedAt,
      }],
      recommendedAction: `Review the final error and safely retry ${job.taskType}.`,
      firstDetected: job.createdAt,
      lastChecked: job.updatedAt,
      status: job.status,
    }));
    return {
      status: 'ACTION REQUIRED',
      action: 'REVIEW EXCEPTIONS',
      exceptions: [...failedJobExceptions, ...taskExceptions],
      truncated: tasksTruncated || failedJobsTruncated,
      returned: {
        tasks: visibleTasks.length,
        failedJobs: visibleFailedJobs.length,
      },
    };
  }

  async updateTask(
    id: string,
    patch: {
      status?: OperationsTask['status'];
      priority?: OperationsTask['priority'];
      assignedOperatorId?: string | null;
      dueAt?: Date | null;
      evidenceNote?: string | null;
    },
  ) {
    const task = await this.repo.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Operations task not found');
    if (patch.status !== undefined) task.status = patch.status;
    if (patch.priority !== undefined) task.priority = patch.priority;
    if (patch.assignedOperatorId !== undefined) {
      await this.platformOperators?.requireAssignable(patch.assignedOperatorId);
      task.assignedOperatorId = patch.assignedOperatorId;
    }
    if (patch.dueAt !== undefined) task.dueAt = patch.dueAt;
    if (patch.evidenceNote !== undefined) task.evidenceNote = patch.evidenceNote;
    task.completedAt = task.status === 'resolved' ? new Date() : null;
    const saved = await this.repo.save(task);
    if (patch.assignedOperatorId) {
      await this.notifications?.createForPlatform({
        eventType: 'task.assigned',
        category: 'tasks',
        severity: saved.priority === 'critical' ? 'critical' : 'warning',
        title: 'Task assigned to you',
        message: saved.title,
        deduplicationKey: `operations-task-assigned:${saved.id}:${patch.assignedOperatorId}`,
        assignedOperatorId: patch.assignedOperatorId,
        actionUrl: '/admin/dashboard?view=tasks',
        entityType: 'operations_task',
        entityId: saved.id,
      });
    }
    return saved;
  }

  async unresolvedHighPriorityCount() {
    return this.repo
      .createQueryBuilder('task')
      .where('task.status != :resolved', { resolved: 'resolved' })
      .andWhere('task.priority IN (:...priorities)', {
        priorities: ['high', 'critical'],
      })
      .getCount();
  }

  async hasOpenSafetyIncident(tenantId: string) {
    const count = await this.repo
      .createQueryBuilder('task')
      .where('task.tenantId = :tenantId', { tenantId })
      .andWhere('task.status != :resolved', { resolved: 'resolved' })
      .andWhere('task.category IN (:...categories)', {
        categories: ['usage_limit', 'client_quality', 'security_incident'],
      })
      .getCount();
    return count > 0;
  }

  async resolveRecoverableTasks(input: {
    tenantId?: string | null;
    category: string;
    relatedEntityType: string;
    relatedEntityId: string;
    evidenceNote: string;
  }) {
    const rows = await this.repo.find({
      where: {
        ...(input.tenantId === null
          ? { tenantId: IsNull() }
          : input.tenantId
            ? { tenantId: input.tenantId }
            : {}),
        category: input.category,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
        status: In(['open', 'in_progress', 'blocked']),
      },
    });
    if (!rows.length) return 0;
    const completedAt = new Date();
    for (const row of rows) {
      row.status = 'resolved';
      row.completedAt = completedAt;
      row.evidenceNote = input.evidenceNote;
    }
    await this.repo.save(rows);
    return rows.length;
  }
}
