import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { sanitizeOperationalText } from '../../common/operational-log';
import { WorkerHeartbeat } from './worker-heartbeat.entity';

export type HeartbeatSource = 'direct' | 'durable_job' | 'observed';

export interface WorkerDefinition {
  key: string;
  displayName: string;
  expectedIntervalSeconds: number;
  critical: boolean;
  source: HeartbeatSource;
  /** Durable task types whose activity proves the worker ran. */
  durableTaskTypes?: string[];
  /** Best-effort activity probe for workers that cannot report directly. */
  observedQuery?: string;
  /** Raise this in the supervisor when the worker was once active and went quiet. */
  alertWhenMissing?: boolean;
}

/**
 * Inventory of every in-process timer/worker plus the durable-job-backed
 * recurring scans. Workers in other modules report via recordTick/recordFailure
 * (this module is @Global(), so the API is injectable anywhere); workers that
 * cannot be touched yet are derived from durable_jobs or domain-table
 * activity on a best-effort basis.
 */
export const WORKER_INVENTORY: WorkerDefinition[] = [
  {
    key: 'durable_job_worker',
    displayName: 'Durable job worker (5s poll)',
    expectedIntervalSeconds: 5,
    critical: true,
    source: 'direct',
  },
  {
    key: 'ai_worker',
    displayName: 'AI conversation worker (3s poll)',
    expectedIntervalSeconds: 3,
    critical: true,
    source: 'observed',
    observedQuery: 'SELECT MAX(updated_at) AS last_activity FROM ai_runs',
  },
  {
    key: 'message_sender',
    displayName: 'Outbound message sender (5s poll)',
    expectedIntervalSeconds: 5,
    critical: true,
    source: 'observed',
    observedQuery: 'SELECT MAX(updated_at) AS last_activity FROM messages',
  },
  {
    key: 'sequence_worker',
    displayName: 'Sequence worker (10s poll)',
    expectedIntervalSeconds: 10,
    critical: true,
    source: 'observed',
    observedQuery:
      'SELECT MAX(updated_at) AS last_activity FROM sequence_enrollments',
  },
  {
    key: 'billing_grace_monitor',
    displayName: 'Billing grace monitor (5min)',
    expectedIntervalSeconds: 300,
    critical: true,
    source: 'observed',
  },
  {
    key: 'handoff_escalation',
    displayName: 'Handoff escalation checks (1min)',
    expectedIntervalSeconds: 60,
    critical: false,
    source: 'observed',
  },
  {
    key: 'operational_reminders',
    displayName: 'Operational reminders (1h)',
    expectedIntervalSeconds: 3600,
    critical: false,
    source: 'observed',
  },
  {
    key: 'health_critical_scan',
    displayName: 'health.critical_scan (5min durable)',
    expectedIntervalSeconds: 300,
    critical: true,
    source: 'durable_job',
    durableTaskTypes: ['health.critical_scan'],
    alertWhenMissing: true,
  },
  {
    key: 'safety_quality_scan',
    displayName: 'safety.quality_scan (5min durable)',
    expectedIntervalSeconds: 300,
    critical: true,
    source: 'durable_job',
    durableTaskTypes: ['safety.quality_scan'],
    alertWhenMissing: true,
  },
  {
    key: 'tenant_provisioning_scan',
    displayName: 'tenant.provisioning_scan (15min durable)',
    expectedIntervalSeconds: 900,
    critical: true,
    source: 'durable_job',
    durableTaskTypes: ['tenant.provisioning_scan'],
    alertWhenMissing: true,
  },
  {
    key: 'twilio_a2p_reconcile',
    displayName: 'twilio.a2p_reconcile (15min durable)',
    expectedIntervalSeconds: 900,
    critical: false,
    source: 'durable_job',
    durableTaskTypes: ['twilio.a2p_reconcile'],
  },
  {
    key: 'calendar_watch_renewals',
    displayName: 'Calendar watch renewals (durable)',
    expectedIntervalSeconds: 86400,
    critical: true,
    source: 'durable_job',
    durableTaskTypes: [
      'calendar.google.renew_watch',
      'calendar.microsoft.renew_subscription',
    ],
  },
  {
    key: 'calendar_calendly_reconcile',
    displayName: 'calendar.calendly.reconcile_all (15min durable)',
    expectedIntervalSeconds: 900,
    critical: false,
    source: 'durable_job',
    durableTaskTypes: ['calendar.calendly.reconcile_all'],
  },
  {
    key: 'durable_job_supervisor',
    displayName: 'Durable job supervisor (5min scan)',
    expectedIntervalSeconds: 300,
    critical: true,
    source: 'direct',
  },
];

export interface WorkerHealthSnapshot {
  workerKey: string;
  displayName: string;
  expectedIntervalSeconds: number;
  critical: boolean;
  source: HeartbeatSource;
  status: 'ok' | 'stale' | 'failing' | 'unknown';
  lastSuccessAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  lastCheckAt: Date | null;
}

const FAILING_THRESHOLD = 3;
/** Observed workers only page after a full quiet day (idle ≠ dead). */
const OBSERVED_STALE_SECONDS = 24 * 3600;

@Injectable()
export class WorkerHeartbeatService {
  private readonly logger = new Logger(WorkerHeartbeatService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    @InjectRepository(WorkerHeartbeat)
    private readonly heartbeats?: Repository<WorkerHeartbeat>,
  ) {}

  /** Idempotent: safe to call on every boot. */
  async ensureSeeded(): Promise<void> {
    for (const def of WORKER_INVENTORY) {
      try {
        await this.dataSource.query(
          `INSERT INTO worker_heartbeat
             (worker_key, display_name, expected_interval_seconds, is_critical, heartbeat_source)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (worker_key) DO UPDATE SET
             display_name = EXCLUDED.display_name,
             expected_interval_seconds = EXCLUDED.expected_interval_seconds,
             is_critical = EXCLUDED.is_critical,
             heartbeat_source = EXCLUDED.heartbeat_source,
             updated_at = NOW()`,
          [def.key, def.displayName, def.expectedIntervalSeconds, def.critical, def.source],
        );
      } catch (error) {
        this.logger.warn(
          `worker heartbeat seed failed for ${def.key}: ${sanitizeOperationalText(error instanceof Error ? error.message : String(error))}`,
        );
      }
    }
  }

  /** Direct liveness signal from the worker itself. */
  async recordTick(workerKey: string): Promise<void> {
    const def = WORKER_INVENTORY.find((w) => w.key === workerKey);
    try {
      await this.dataSource.query(
        `INSERT INTO worker_heartbeat
           (worker_key, display_name, expected_interval_seconds, is_critical, heartbeat_source,
            last_success_at, last_error, consecutive_failures, last_check_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NULL, 0, NOW())
         ON CONFLICT (worker_key) DO UPDATE SET
           last_success_at = NOW(),
           last_error = NULL,
           consecutive_failures = 0,
           last_check_at = NOW(),
           updated_at = NOW()`,
        [
          workerKey,
          def?.displayName || workerKey,
          def?.expectedIntervalSeconds || 300,
          def?.critical ?? false,
          def?.source || 'direct',
        ],
      );
    } catch (error) {
      this.logger.warn(
        `worker heartbeat tick failed for ${workerKey}: ${sanitizeOperationalText(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  async recordFailure(workerKey: string, error: unknown): Promise<void> {
    const def = WORKER_INVENTORY.find((w) => w.key === workerKey);
    const message = sanitizeOperationalText(
      error instanceof Error ? error.message : String(error),
      2000,
    );
    try {
      await this.dataSource.query(
        `INSERT INTO worker_heartbeat
           (worker_key, display_name, expected_interval_seconds, is_critical, heartbeat_source,
            last_error, consecutive_failures, last_check_at)
         VALUES ($1, $2, $3, $4, $5, $6, 1, NOW())
         ON CONFLICT (worker_key) DO UPDATE SET
           last_error = EXCLUDED.last_error,
           consecutive_failures = worker_heartbeat.consecutive_failures + 1,
           last_check_at = NOW(),
           updated_at = NOW()`,
        [
          workerKey,
          def?.displayName || workerKey,
          def?.expectedIntervalSeconds || 300,
          def?.critical ?? false,
          def?.source || 'direct',
          message,
        ],
      );
    } catch (dbError) {
      this.logger.warn(
        `worker heartbeat failure record failed for ${workerKey}: ${sanitizeOperationalText(dbError instanceof Error ? dbError.message : String(dbError))}`,
      );
    }
  }

  /**
   * Refreshes derived heartbeats from durable_jobs activity and domain-table
   * probes. Called by the supervisor on each scan; never throws.
   */
  async refreshDerived(now = new Date()): Promise<void> {
    try {
      await this.ensureSeeded();
    } catch {
      return;
    }
    for (const def of WORKER_INVENTORY) {
      try {
        if (def.source === 'durable_job' && def.durableTaskTypes?.length) {
          const rows: Array<{ last_activity: Date | null }> =
            await this.dataSource.query(
              `SELECT MAX(GREATEST(updated_at, COALESCE(completed_at, updated_at))) AS last_activity
                 FROM durable_jobs
                WHERE task_type = ANY($1)`,
              [def.durableTaskTypes],
            );
          const activity = rows[0]?.last_activity
            ? new Date(rows[0].last_activity)
            : null;
          if (activity) await this.noteObservedActivity(def.key, activity);
        } else if (def.source === 'observed' && def.observedQuery) {
          const rows: Array<{ last_activity: Date | null }> =
            await this.dataSource.query(def.observedQuery);
          const activity = rows[0]?.last_activity
            ? new Date(rows[0].last_activity)
            : null;
          if (activity) await this.noteObservedActivity(def.key, activity, now);
        }
      } catch (error) {
        this.logger.debug(
          `worker heartbeat probe failed for ${def.key}: ${sanitizeOperationalText(error instanceof Error ? error.message : String(error))}`,
        );
      }
    }
    try {
      await this.dataSource.query(
        `UPDATE worker_heartbeat SET last_check_at = $1, updated_at = NOW()`,
        [now],
      );
    } catch {
      // best effort
    }
  }

  private async noteObservedActivity(
    workerKey: string,
    activity: Date,
    now = new Date(),
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE worker_heartbeat
          SET last_success_at = GREATEST(COALESCE(last_success_at, 'epoch'::timestamptz), $2),
              consecutive_failures = 0,
              last_error = NULL,
              last_check_at = $3,
              updated_at = NOW()
        WHERE worker_key = $1`,
      [workerKey, activity, now],
    );
  }

  async snapshot(now = new Date()): Promise<WorkerHealthSnapshot[]> {
    const defs = new Map(WORKER_INVENTORY.map((d) => [d.key, d]));
    let rows: WorkerHeartbeat[] = [];
    try {
      rows = this.heartbeats
        ? await this.heartbeats.find()
        : await this.dataSource.query(`SELECT * FROM worker_heartbeat`);
    } catch {
      return [];
    }
    return rows.map((row) => {
      const def = defs.get(row.workerKey);
      const expected = def?.expectedIntervalSeconds ?? row.expectedIntervalSeconds ?? 300;
      const critical = def?.critical ?? row.isCritical ?? false;
      const source = (def?.source ?? row.heartbeatSource ?? 'direct') as HeartbeatSource;
      const lastSuccess = row.lastSuccessAt ? new Date(row.lastSuccessAt) : null;
      let status: WorkerHealthSnapshot['status'] = 'unknown';
      if ((row.consecutiveFailures ?? 0) >= FAILING_THRESHOLD) {
        status = 'failing';
      } else if (lastSuccess) {
        const staleAfter =
          source === 'observed'
            ? OBSERVED_STALE_SECONDS
            : Math.max(3 * expected, 60);
        status =
          now.getTime() - lastSuccess.getTime() > staleAfter * 1000
            ? 'stale'
            : 'ok';
      } else if (def?.alertWhenMissing) {
        // Expected to exist in a running deployment but never seen.
        const seededAt = row.createdAt ? new Date(row.createdAt).getTime() : now.getTime();
        status =
          now.getTime() - seededAt > Math.max(3 * expected, 60) * 1000
            ? 'stale'
            : 'unknown';
      }
      return {
        workerKey: row.workerKey,
        displayName: row.displayName,
        expectedIntervalSeconds: expected,
        critical,
        source,
        status,
        lastSuccessAt: lastSuccess,
        lastError: row.lastError,
        consecutiveFailures: row.consecutiveFailures ?? 0,
        lastCheckAt: row.lastCheckAt ? new Date(row.lastCheckAt) : null,
      };
    });
  }
}
