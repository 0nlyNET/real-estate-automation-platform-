import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { operationalEvent } from '../../common/operational-log';
import { StripeWebhookEvent } from '../billing/stripe-webhook-event.entity';
import { AdminNotification } from './notification.entity';
import { AiRun } from '../ai/ai-run.entity';
import { DurableJobsService } from '../durable-jobs/durable-jobs.service';

@Injectable()
export class RetentionService implements OnModuleInit {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    @InjectRepository(StripeWebhookEvent)
    private readonly webhookLogs: Repository<StripeWebhookEvent>,
    @InjectRepository(AdminNotification)
    private readonly notifications: Repository<AdminNotification>,
    @InjectRepository(AiRun)
    private readonly aiRuns: Repository<AiRun>,
    @Optional() private readonly durableJobs?: DurableJobsService,
  ) {}

  onModuleInit() {
    if (!this.durableJobs) return;
    this.durableJobs.register('retention.cleanup', async () => {
      await this.run();
      return { nextRunAt: new Date(Date.now() + 24 * 60 * 60_000) };
    });
    if (process.env.NODE_ENV !== 'test') {
      void this.durableJobs.schedule({
        taskType: 'retention.cleanup',
        dedupeKey: 'recurring:retention.cleanup',
      });
    }
  }

  retentionDays() {
    const configured = Number(process.env.OPERATIONAL_RETENTION_DAYS || 90);
    return Number.isInteger(configured) && configured >= 30 && configured <= 365
      ? configured
      : 90;
  }

  async run(now = new Date()) {
    const startedAt = Date.now();
    const cutoff = new Date(now.getTime() - this.retentionDays() * 24 * 60 * 60 * 1000);
    try {
      const errors: string[] = [];
      const safely = async <T extends { id: string; createdAt: Date }>(
        name: string,
        repository: Repository<T>,
      ) => {
        try {
          return await this.purgeInBatches(repository, cutoff);
        } catch (error: unknown) {
          errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
          return 0;
        }
      };
      const webhook = await safely('webhook logs', this.webhookLogs);
      const notification = await safely('notifications', this.notifications);
      const aiRun = await safely('AI operational records', this.aiRuns);
      const result = {
        ok: errors.length === 0,
        cutoff: cutoff.toISOString(),
        deleted: {
          auditEvents: 0,
          webhookProcessingLogs: webhook,
          notifications: notification,
          aiRuns: aiRun,
        },
        errors,
        durationMs: Date.now() - startedAt,
      };
      if (result.ok) this.logger.log(operationalEvent('retention_cleanup_completed', result));
      else this.logger.error(operationalEvent('retention_cleanup_partial_failure', result));
      return result;
    } catch (error: unknown) {
      this.logger.error(
        operationalEvent('retention_cleanup_failed', {
          cutoff: cutoff.toISOString(),
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw error;
    }
  }

  private async purgeInBatches<T extends { id: string; createdAt: Date }>(
    repository: Repository<T>,
    cutoff: Date,
  ) {
    const batchSize = 1_000;
    let deleted = 0;
    let hasMore = true;
    while (hasMore) {
      const rows = await repository.find({
        select: { id: true } as any,
        where: { createdAt: LessThan(cutoff) } as any,
        order: { createdAt: 'ASC' } as any,
        take: batchSize,
      });
      if (!rows.length) return deleted;
      const result = await repository.delete({
        id: In(rows.map((row) => row.id)),
      } as any);
      deleted += result.affected || 0;
      hasMore = rows.length === batchSize;
      if (hasMore) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return deleted;
  }
}
