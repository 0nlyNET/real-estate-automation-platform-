import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, LessThan, Repository } from 'typeorm';
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
};

@Injectable()
export class OperationsService {
  constructor(
    @InjectRepository(OperationsTask)
    private readonly repo: Repository<OperationsTask>,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly platformOperators?: PlatformOperatorsService,
    @Optional()
    @InjectRepository(DurableJob)
    private readonly jobs?: Repository<DurableJob>,
  ) {}

  async createTask(input: CreateOperationsTask) {
    if (input.dedupeOpen && input.relatedEntityType && input.relatedEntityId) {
      const existing = await this.repo.findOne({
        where: {
          category: input.category,
          relatedEntityType: input.relatedEntityType,
          relatedEntityId: input.relatedEntityId,
          status: 'open',
        },
      });
      if (existing) return existing;
    }

    if (input.assignedOperatorId) {
      await this.platformOperators?.requireAssignable(input.assignedOperatorId);
    }
    const saved = await this.repo.save(
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
    if (saved.priority === 'high' || saved.priority === 'critical' || saved.assignedOperatorId) {
      await this.notifications?.createForPlatform({
        eventType: saved.assignedOperatorId ? 'task.assigned' : 'task.created',
        category: 'tasks',
        severity: saved.priority === 'critical' ? 'critical' : 'warning',
        title: saved.assignedOperatorId ? 'Task assigned to you' : saved.title,
        message: saved.description,
        deduplicationKey: `operations-task:${saved.id}:${saved.assignedOperatorId || 'queue'}`,
        assignedOperatorId: saved.assignedOperatorId,
        actionUrl: '/admin/dashboard?view=tasks',
        entityType: 'operations_task',
        entityId: saved.id,
      });
    }
    return saved;
  }

  async list(filters: {
    status?: string;
    category?: string;
    tenantId?: string;
    priority?: string;
    overdue?: boolean;
    take?: number;
    skip?: number;
  }) {
    const where: FindOptionsWhere<OperationsTask> = {};
    if (filters.status) where.status = filters.status as OperationsTask['status'];
    if (filters.category) where.category = filters.category;
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.priority)
      where.priority = filters.priority as OperationsTask['priority'];
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
    const [tasks, failedJobs] = await Promise.all([
      this.repo
        .createQueryBuilder('task')
        .where('task.status != :resolved', { resolved: 'resolved' })
        .orderBy("CASE task.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END", 'DESC')
        .addOrderBy('task.createdAt', 'ASC')
        .getMany(),
      this.jobs
        ? this.jobs.find({
            where: { status: 'failed' },
            order: { updatedAt: 'DESC' },
            take: 200,
          })
        : Promise.resolve([]),
    ]);
    if (!tasks.length && !failedJobs.length) {
      return { status: 'HEALTHY', action: 'NO ACTION', exceptions: [] };
    }
    const tenantIds = [...new Set(tasks.map((task) => task.tenantId).filter(Boolean))] as string[];
    const jobs = tenantIds.length && this.jobs
      ? await this.jobs.find({
          where: { tenantId: In(tenantIds) },
          order: { updatedAt: 'DESC' },
          take: 500,
        })
      : [];
    const taskExceptions = tasks.map((task) => {
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
    const failedJobExceptions = failedJobs.map((job) => ({
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
