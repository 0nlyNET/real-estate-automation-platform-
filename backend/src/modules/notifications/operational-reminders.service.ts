import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { operationalEvent } from '../../common/operational-log';
import { OperationsTask } from '../operations/operations-task.entity';
import { ProspectApplication } from '../public/prospect-application.entity';
import { NotificationsService } from './notifications.service';

@Injectable()
export class OperationalRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OperationalRemindersService.name);
  private initialTimer?: NodeJS.Timeout;
  private interval?: NodeJS.Timeout;

  constructor(
    @InjectRepository(OperationsTask)
    private readonly tasks: Repository<OperationsTask>,
    @InjectRepository(ProspectApplication)
    private readonly applications: Repository<ProspectApplication>,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.initialTimer = setTimeout(() => void this.run().catch(() => undefined), 30_000);
    this.interval = setInterval(() => void this.run().catch(() => undefined), 60 * 60 * 1000);
    this.initialTimer.unref();
    this.interval.unref();
  }

  onModuleDestroy() {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.interval) clearInterval(this.interval);
  }

  async run(now = new Date()) {
    const dueSoon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const followUpCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const day = now.toISOString().slice(0, 10);
    const [tasks, applications] = await Promise.all([
      this.tasks.find({
        where: {
          status: In(['open', 'in_progress', 'blocked']),
          dueAt: LessThanOrEqual(dueSoon),
        },
        order: { dueAt: 'ASC' },
        take: 500,
      }),
      this.applications.find({
        where: {
          status: In(['new', 'reviewing']),
          createdAt: LessThan(followUpCutoff),
        },
        order: { createdAt: 'ASC' },
        take: 200,
      }),
    ]);

    for (const task of tasks) {
      const overdue = Boolean(task.dueAt && task.dueAt < now);
      await this.notifications.createForPlatform({
        eventType: overdue ? 'task.overdue' : 'task.due_soon',
        category: 'tasks',
        severity: overdue && task.priority === 'critical' ? 'critical' : 'warning',
        title: overdue ? 'Operations task is overdue' : 'Operations task is due soon',
        message: `${task.title}. ${overdue ? 'Update or resolve it now.' : 'It is due within 24 hours.'}`,
        deduplicationKey: `task-reminder:${task.id}:${overdue ? 'overdue' : 'due'}:${day}`,
        assignedOperatorId: task.assignedOperatorId,
        actionUrl: '/admin/dashboard?view=tasks',
        entityType: 'operations_task',
        entityId: task.id,
      });
    }

    for (const application of applications) {
      await this.notifications.createForPlatform({
        eventType: 'lead.follow_up_overdue',
        category: 'leads',
        severity: 'warning',
        title: 'Prospective client still needs follow-up',
        message: `${application.company || application.name} has waited more than 24 hours for an updated review status.`,
        deduplicationKey: `lead-follow-up:${application.id}:${day}`,
        assignedOperatorId: application.assignedOperatorId,
        actionUrl: '/admin/dashboard?view=leads',
        entityType: 'prospect_application',
        entityId: application.id,
      });
    }

    const result = { tasks: tasks.length, applications: applications.length };
    this.logger.log(operationalEvent('operational_reminders_completed', result));
    return result;
  }
}
