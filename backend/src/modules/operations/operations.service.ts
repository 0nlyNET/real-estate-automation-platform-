import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, LessThan, Repository } from 'typeorm';
import { OperationsTask } from './operations-task.entity';

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

    return this.repo.save(
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
    if (patch.assignedOperatorId !== undefined)
      task.assignedOperatorId = patch.assignedOperatorId;
    if (patch.dueAt !== undefined) task.dueAt = patch.dueAt;
    if (patch.evidenceNote !== undefined) task.evidenceNote = patch.evidenceNote;
    task.completedAt = task.status === 'resolved' ? new Date() : null;
    return this.repo.save(task);
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
}
