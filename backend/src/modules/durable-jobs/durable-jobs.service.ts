import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { sanitizeOperationalText } from '../../common/operational-log';
import { DurableJob } from './durable-job.entity';

export type DurableJobHandler = (
  job: DurableJob,
) => Promise<{ nextRunAt?: Date } | void>;

const RESUME_BATCH_LIMIT = 5;
const DEFAULT_AUTOMATION_MAX_AGE_MS = 15 * 60_000;
const AUTOMATION_TASK_PREFIXES = [
  'appointment.',
  'calendar.',
  'integration.webhook_',
  'tenant.provision',
  'testing.start',
  'twilio.a2p_',
];

@Injectable()
export class DurableJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DurableJobsService.name);
  private readonly workerId = `jobs:${process.env.HOSTNAME || process.pid}:${randomUUID()}`;
  private readonly handlers = new Map<string, DurableJobHandler>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DurableJob)
    private readonly jobs: Repository<DurableJob>,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    // This timer only wakes the worker. Every task, retry, and lease is stored
    // in PostgreSQL and can be claimed by another instance after a restart.
    this.timer = setInterval(
      () => void this.runDue().catch((error) =>
        this.logger.error(
          `Durable job worker failed: ${sanitizeOperationalText(error?.message || error)}`,
        )),
      5_000,
    );
    this.timer.unref();
    void this.runDue().catch(() => undefined);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  register(taskType: string, handler: DurableJobHandler) {
    this.handlers.set(taskType, handler);
  }

  async schedule(input: {
    taskType: string;
    tenantId?: string | null;
    dedupeKey?: string | null;
    payload?: Record<string, unknown>;
    nextRunAt?: Date;
    maxAttempts?: number;
  }) {
    const values = {
      taskType: input.taskType,
      tenantId: input.tenantId || null,
      dedupeKey: input.dedupeKey || null,
      payload: input.payload || {},
      status: 'scheduled' as const,
      nextRunAt: input.nextRunAt || new Date(),
      attemptCount: 0,
      maxAttempts: input.maxAttempts || 12,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
      completedAt: null,
    };
    if (!values.dedupeKey) return this.jobs.save(this.jobs.create(values));
    const dedupeKey = values.dedupeKey;
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `durable-job:${dedupeKey}`,
      ]);
      const repository = manager.getRepository(DurableJob);
      const existing = await repository.findOne({
        where: { dedupeKey },
      });
      // Scheduling the same work while a worker owns it must not clear its
      // lease or make it concurrently claimable.
      if (existing?.status === 'running') return existing;
      if (existing) {
        Object.assign(existing, values);
        return repository.save(existing);
      }
      return repository.save(repository.create(values));
    });
  }

  async runDue(limit = 20) {
    const paused = process.env.GLOBAL_AUTOMATIONS_DISABLED === 'true';
    // A bounded resume batch is deliberate: a deployment that clears the
    // global switch must never turn database recovery into an outbound burst.
    const effectiveLimit = paused
      ? limit
      : Math.min(limit, RESUME_BATCH_LIMIT);
    let processed = 0;
    while (processed < effectiveLimit) {
      const job = await this.claimNext(paused);
      if (!job) break;
      processed += 1;
      await this.execute(job);
    }
    return processed;
  }

  private async claimNext(globalAutomationPaused: boolean) {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `SELECT * FROM durable_jobs
          WHERE ((status = 'scheduled' AND next_run_at <= NOW())
             OR (status = 'running' AND lease_expires_at < NOW()))
          ${globalAutomationPaused ? `AND NOT (${AUTOMATION_TASK_PREFIXES.map((_, index) => `task_type LIKE $${index + 1}`).join(' OR ')})` : ''}
          ORDER BY COALESCE(lease_expires_at, next_run_at) ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
        globalAutomationPaused
          ? AUTOMATION_TASK_PREFIXES.map((prefix) => `${prefix}%`)
          : [],
      );
      if (!rows[0]) return null;
      await manager.query(
        `UPDATE durable_jobs
          SET status = 'running', lease_owner = $2,
              lease_expires_at = NOW() + INTERVAL '5 minutes',
              attempt_count = attempt_count + 1, updated_at = NOW()
          WHERE id = $1`,
        [rows[0].id, this.workerId],
      );
      return manager.getRepository(DurableJob).findOne({
        where: { id: rows[0].id },
      });
    });
  }

  private async execute(job: DurableJob) {
    const handler = this.handlers.get(job.taskType);
    try {
      if (!handler) throw new Error(`No handler registered for ${job.taskType}`);
      const staleAutomation =
        this.isAutomationTask(job.taskType) &&
        Date.now() - new Date(job.nextRunAt).getTime() > this.automationMaxAgeMs();
      if (staleAutomation) {
        job.status = 'cancelled';
        job.lastError =
          'Cancelled on resume: automation job exceeded the safe replay age and must be re-evaluated from current state.';
        job.completedAt = new Date();
      } else {
        const result = await handler(job);
        if (result?.nextRunAt) {
          job.status = 'scheduled';
          job.nextRunAt = result.nextRunAt;
          job.attemptCount = 0;
          job.lastError = null;
        } else {
          job.status = 'completed';
          job.completedAt = new Date();
          job.lastError = null;
        }
      }
    } catch (error: any) {
      job.lastError = sanitizeOperationalText(error?.message || error, 2_000);
      if (job.attemptCount >= job.maxAttempts) {
        job.status = 'failed';
      } else {
        job.status = 'scheduled';
        const delay = Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.min(job.attemptCount, 10));
        job.nextRunAt = new Date(Date.now() + delay);
      }
    }
    job.leaseOwner = null;
    job.leaseExpiresAt = null;
    await this.jobs.save(job);
  }

  private isAutomationTask(taskType: string) {
    return AUTOMATION_TASK_PREFIXES.some((prefix) => taskType.startsWith(prefix));
  }

  private automationMaxAgeMs() {
    const configured = Number(process.env.AUTOMATION_RESUME_MAX_AGE_MINUTES || 15);
    return Number.isFinite(configured) && configured > 0
      ? configured * 60_000
      : DEFAULT_AUTOMATION_MAX_AGE_MS;
  }
}
