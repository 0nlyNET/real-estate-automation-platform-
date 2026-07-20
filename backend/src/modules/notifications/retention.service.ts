import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { operationalEvent } from '../../common/operational-log';
import { AuditLog } from '../audit/audit-log.entity';
import { StripeWebhookEvent } from '../billing/stripe-webhook-event.entity';
import { AdminNotification } from './notification.entity';

@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
    @InjectRepository(StripeWebhookEvent)
    private readonly webhookLogs: Repository<StripeWebhookEvent>,
    @InjectRepository(AdminNotification)
    private readonly notifications: Repository<AdminNotification>,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV !== 'test') {
      void this.run().catch(() => undefined);
      this.timer = setInterval(() => void this.run().catch(() => undefined), 24 * 60 * 60 * 1000);
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
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
      const audit = await safely('audit events', this.auditLogs);
      const webhook = await safely('webhook logs', this.webhookLogs);
      const notification = await safely('notifications', this.notifications);
      const result = {
        ok: errors.length === 0,
        cutoff: cutoff.toISOString(),
        deleted: {
          auditEvents: audit,
          webhookProcessingLogs: webhook,
          notifications: notification,
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
