import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { sanitizeOperationalText } from '../../common/operational-log';
import { OperationalEventsService } from '../notifications/operational-events.service';
import { DurableJob } from './durable-job.entity';
import { DurableJobsService } from './durable-jobs.service';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

export interface SupervisorFinding {
  kind:
    | 'failed_jobs'
    | 'repeated_failures'
    | 'stalled_processing'
    | 'scheduler_inactive'
    | 'cadence_missed';
  severity: 'warning' | 'critical';
  /** False for findings about the alert pipeline itself (loop protection). */
  alertable: boolean;
  summary: string;
  details: Record<string, unknown>;
}

interface CriticalCadence {
  label: string;
  taskTypes: string[];
  expectedIntervalSeconds: number;
  critical: boolean;
  /** Page when the job was never scheduled (recurring platform scans). */
  alertWhenMissing: boolean;
}

/**
 * Expected cadences for the recurring durable jobs the platform depends on.
 * Stale threshold is 3x the expected interval, computed in collectFindings.
 */
const CRITICAL_CADENCES: CriticalCadence[] = [
  {
    label: 'health.critical_scan',
    taskTypes: ['health.critical_scan'],
    expectedIntervalSeconds: 300,
    critical: true,
    alertWhenMissing: true,
  },
  {
    label: 'safety.quality_scan',
    taskTypes: ['safety.quality_scan'],
    expectedIntervalSeconds: 300,
    critical: true,
    alertWhenMissing: true,
  },
  {
    label: 'tenant.provisioning_scan',
    taskTypes: ['tenant.provisioning_scan'],
    expectedIntervalSeconds: 900,
    critical: true,
    alertWhenMissing: true,
  },
  {
    label: 'twilio.a2p_reconcile',
    taskTypes: ['twilio.a2p_reconcile'],
    expectedIntervalSeconds: 900,
    critical: false,
    alertWhenMissing: false,
  },
  {
    label: 'calendar.calendly.reconcile_all',
    taskTypes: ['calendar.calendly.reconcile_all'],
    expectedIntervalSeconds: 900,
    critical: false,
    alertWhenMissing: false,
  },
  {
    label: 'calendar watch renewals',
    taskTypes: [
      'calendar.google.renew_watch',
      'calendar.microsoft.renew_subscription',
    ],
    expectedIntervalSeconds: 86400,
    critical: true,
    alertWhenMissing: false,
  },
];

const SUPERVISOR_TASK_TYPE = 'durable_jobs.supervisor_scan';
const SUPERVISOR_DEDUPE_KEY = 'recurring:durable_jobs.supervisor_scan';
const SUPERVISOR_INTERVAL_MS = 5 * 60_000;
/** A job is "repeatedly failing" well before it exhausts attempts. */
const REPEATED_FAILURE_ATTEMPTS = 8;
/** Alert-plumbing task types: findings about these never page (loop guard). */
const ALERT_PLUMBING_PREFIXES = ['notifications.', SUPERVISOR_TASK_TYPE];
/** Hard cap on supervisor alerts per clock hour (loop guard). */
const MAX_ALERTS_PER_HOUR = 6;

/**
 * Watches the durable_jobs table for the silent graveyard: failed jobs nobody
 * scans, jobs stuck in processing past their lease, critical recurring scans
 * that stopped running, and scheduler inactivity. Alerts through
 * OperationalEventsService (incident-deduped, severity-escalating), never by
 * scheduling more jobs.
 *
 * Infinite-alert-loop protection:
 *  1. Findings about notification/alert delivery jobs are reported but never
 *     alerted — paging about the pager through the pager is a loop.
 *  2. A per-hour alert cap bounds any unforeseen feedback cycle.
 *  3. The underlying incident machinery only re-notifies on severity
 *     escalation, and recovery auto-closes the incident.
 */
@Injectable()
export class DurableJobSupervisorService implements OnModuleInit {
  private readonly logger = new Logger(DurableJobSupervisorService.name);
  private alertHourBucket = '';
  private alertsThisHour = 0;
  private incidentOpen = false;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DurableJob)
    private readonly jobs: Repository<DurableJob>,
    @Optional() private readonly durableJobs?: DurableJobsService,
    @Optional() private readonly heartbeats?: WorkerHeartbeatService,
    @Optional() private readonly operationalEvents?: OperationalEventsService,
  ) {}

  onModuleInit() {
    if (!this.durableJobs || process.env.NODE_ENV === 'test') return;
    this.durableJobs.register(SUPERVISOR_TASK_TYPE, async () => {
      await this.runScan();
      return { nextRunAt: new Date(Date.now() + SUPERVISOR_INTERVAL_MS) };
    });
    void this.durableJobs
      .schedule({
        taskType: SUPERVISOR_TASK_TYPE,
        dedupeKey: SUPERVISOR_DEDUPE_KEY,
      })
      .catch((error: unknown) =>
        this.logger.warn(
          `supervisor schedule failed: ${sanitizeOperationalText(error instanceof Error ? error.message : String(error))}`,
        ),
      );
  }

  /** Runs one supervision pass; returns the findings (also used by tests). */
  async runScan(now = new Date()): Promise<SupervisorFinding[]> {
    try {
      await this.heartbeats?.refreshDerived(now);
    } catch {
      // Derived heartbeats are best effort; the scan continues.
    }
    try {
      await this.heartbeats?.recordTick('durable_job_supervisor');
    } catch {
      // never fail the scan on heartbeat bookkeeping
    }
    let findings: SupervisorFinding[] = [];
    try {
      findings = await this.collectFindings(now);
    } catch (error) {
      await this.heartbeats?.recordFailure(
        'durable_job_supervisor',
        error,
      );
      throw error;
    }
    await this.reportFindings(findings, now);
    return findings;
  }

  async collectFindings(now = new Date()): Promise<SupervisorFinding[]> {
    const findings: SupervisorFinding[] = [];
    const [
      failedRows,
      repeatedRows,
      stalledCount,
      cadenceRows,
      workerTick,
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT id, task_type, tenant_id, attempt_count, max_attempts,
                LEFT(COALESCE(last_error, ''), 200) AS last_error, updated_at
           FROM durable_jobs
          WHERE status = 'failed'
          ORDER BY updated_at DESC
          LIMIT 25`,
      ),
      this.dataSource.query(
        `SELECT id, task_type, tenant_id, attempt_count, max_attempts,
                LEFT(COALESCE(last_error, ''), 200) AS last_error, updated_at
           FROM durable_jobs
          WHERE status IN ('scheduled', 'running')
            AND attempt_count >= $1
            AND attempt_count < max_attempts
          ORDER BY attempt_count DESC
          LIMIT 25`,
        [REPEATED_FAILURE_ATTEMPTS],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS count
           FROM durable_jobs
          WHERE status = 'running' AND lease_expires_at < NOW()`,
      ),
      Promise.all(
        CRITICAL_CADENCES.map(async (cadence) => {
          const rows: Array<{
            total: string;
            last_activity: Date | null;
            overdue: string;
          }> = await this.dataSource.query(
            `SELECT COUNT(*)::text AS total,
                    MAX(GREATEST(updated_at, COALESCE(completed_at, updated_at))) AS last_activity,
                    COUNT(*) FILTER (
                      WHERE status = 'scheduled' AND next_run_at < NOW() - INTERVAL '1 hour'
                    )::text AS overdue
               FROM durable_jobs
              WHERE task_type = ANY($1)`,
            [cadence.taskTypes],
          );
          return { cadence, ...(rows[0] || { total: '0', last_activity: null, overdue: '0' }) };
        }),
      ),
      this.dataSource
        .query(
          `SELECT last_success_at FROM worker_heartbeat WHERE worker_key = 'durable_job_worker'`,
        )
        .catch(() => [] as Array<{ last_success_at: Date | null }>),
    ]);

    const isAlertPlumbing = (taskType: string) =>
      ALERT_PLUMBING_PREFIXES.some((prefix) => taskType.startsWith(prefix));

    const failed = failedRows as Array<{
      id: string;
      task_type: string;
      attempt_count: number;
      max_attempts: number;
      last_error: string;
    }>;
    if (failed.length) {
      const plumbing = failed.filter((j) => isAlertPlumbing(j.task_type));
      const real = failed.filter((j) => !isAlertPlumbing(j.task_type));
      if (real.length) {
        findings.push({
          kind: 'failed_jobs',
          severity: 'critical',
          alertable: true,
          summary: `${real.length} durable job(s) exhausted all attempts and are sitting in 'failed' with no recovery path`,
          details: {
            jobs: real.map((j) => ({
              id: j.id,
              taskType: j.task_type,
              attempts: `${j.attempt_count}/${j.max_attempts}`,
              lastError: j.last_error,
            })),
          },
        });
      }
      if (plumbing.length) {
        findings.push({
          kind: 'failed_jobs',
          severity: 'warning',
          alertable: false,
          summary: `${plumbing.length} alert-pipeline job(s) failed (suppressed from alerting to avoid an alert loop)`,
          details: {
            jobs: plumbing.map((j) => ({ id: j.id, taskType: j.task_type })),
          },
        });
      }
    }

    const repeated = (repeatedRows as Array<{
      id: string;
      task_type: string;
      attempt_count: number;
      max_attempts: number;
      last_error: string;
    }>).filter((j) => !isAlertPlumbing(j.task_type));
    if (repeated.length) {
      findings.push({
        kind: 'repeated_failures',
        severity: 'warning',
        alertable: true,
        summary: `${repeated.length} durable job(s) are failing repeatedly (≥${REPEATED_FAILURE_ATTEMPTS} attempts) and heading for the failed graveyard`,
        details: {
          jobs: repeated.map((j) => ({
            id: j.id,
            taskType: j.task_type,
            attempts: `${j.attempt_count}/${j.max_attempts}`,
            lastError: j.last_error,
          })),
        },
      });
    }

    const stalled = Number(stalledCount?.[0]?.count || 0);
    if (stalled > 0) {
      findings.push({
        kind: 'stalled_processing',
        severity: 'warning',
        alertable: true,
        summary: `${stalled} durable job(s) stuck in 'processing' past their lease expiry`,
        details: { stalled },
      });
    }

    // Scheduler inactivity: the 5s worker ticks its heartbeat on every runDue.
    const lastTick = workerTick?.[0]?.last_success_at
      ? new Date(workerTick[0].last_success_at).getTime()
      : 0;
    if (!lastTick || now.getTime() - lastTick > 120_000) {
      findings.push({
        kind: 'scheduler_inactive',
        severity: 'critical',
        alertable: true,
        summary:
          'The durable job worker has not ticked in over 2 minutes — scheduled work may not be executing',
        details: {
          lastTickAt: lastTick ? new Date(lastTick).toISOString() : null,
        },
      });
    }

    for (const { cadence, total, last_activity, overdue } of cadenceRows) {
      const totalJobs = Number(total || 0);
      const overdueCount = Number(overdue || 0);
      const lastActivity = last_activity ? new Date(last_activity).getTime() : 0;
      const staleAfterMs = 3 * cadence.expectedIntervalSeconds * 1000;
      if (totalJobs === 0 && cadence.alertWhenMissing) {
        findings.push({
          kind: 'cadence_missed',
          severity: cadence.critical ? 'critical' : 'warning',
          alertable: true,
          summary: `Critical recurring job '${cadence.label}' was never scheduled — its scan is not running`,
          details: { taskTypes: cadence.taskTypes },
        });
      } else if (lastActivity && now.getTime() - lastActivity > staleAfterMs) {
        findings.push({
          kind: 'cadence_missed',
          severity: cadence.critical ? 'critical' : 'warning',
          alertable: true,
          summary: `Critical recurring job '${cadence.label}' has not run in ${Math.round((now.getTime() - lastActivity) / 60000)} minutes (expected every ${Math.round(cadence.expectedIntervalSeconds / 60)}m)`,
          details: {
            taskTypes: cadence.taskTypes,
            lastActivityAt: new Date(lastActivity).toISOString(),
          },
        });
      } else if (overdueCount > 0) {
        findings.push({
          kind: 'cadence_missed',
          severity: 'warning',
          alertable: true,
          summary: `${overdueCount} '${cadence.label}' job(s) are overdue for renewal/reconciliation`,
          details: { taskTypes: cadence.taskTypes, overdue: overdueCount },
        });
      }
    }

    // Critical workers stalled beyond their heartbeat threshold.
    try {
      const snapshot = await this.heartbeats?.snapshot(now);
      const stalledWorkers = (snapshot || []).filter(
        (w) => w.critical && (w.status === 'stale' || w.status === 'failing'),
      );
      for (const worker of stalledWorkers) {
        if (worker.workerKey === 'durable_job_worker') continue; // covered by scheduler_inactive
        findings.push({
          kind: 'scheduler_inactive',
          severity: 'critical',
          alertable: true,
          summary: `Critical worker '${worker.displayName}' is ${worker.status} (last success: ${worker.lastSuccessAt?.toISOString() || 'never'})`,
          details: {
            workerKey: worker.workerKey,
            status: worker.status,
            consecutiveFailures: worker.consecutiveFailures,
            lastError: worker.lastError,
          },
        });
      }
    } catch {
      // heartbeat snapshot is best effort
    }

    return findings;
  }

  private async reportFindings(
    findings: SupervisorFinding[],
    now = new Date(),
  ): Promise<void> {
    const alertable = findings.filter((f) => f.alertable);
    const suppressed = findings.filter((f) => !f.alertable);
    for (const finding of suppressed) {
      this.logger.warn(`supervisor finding (alert suppressed): ${finding.summary}`);
    }
    if (!alertable.length) {
      if (this.incidentOpen) {
        this.incidentOpen = false;
        try {
          await this.operationalEvents?.integrationRecovered({
            provider: 'DurableJobs',
          });
        } catch (error) {
          this.logger.warn(
            `supervisor recovery notify failed: ${sanitizeOperationalText(error instanceof Error ? error.message : String(error))}`,
          );
        }
      }
      return;
    }

    const critical = alertable.some((f) => f.severity === 'critical');
    const summary = alertable.map((f) => f.summary).join(' | ');
    this.logger.warn(`supervisor findings: ${summary}`);

    if (!this.operationalEvents) return;
    const bucket = now.toISOString().slice(0, 13);
    if (bucket !== this.alertHourBucket) {
      this.alertHourBucket = bucket;
      this.alertsThisHour = 0;
    }
    if (this.alertsThisHour >= MAX_ALERTS_PER_HOUR) {
      this.logger.error(
        `supervisor alert cap (${MAX_ALERTS_PER_HOUR}/hour) reached — suppressing further alerts this hour`,
      );
      return;
    }
    this.alertsThisHour += 1;
    this.incidentOpen = true;
    try {
      await this.operationalEvents.integrationFailed({
        provider: 'DurableJobs',
        platformImpact: critical,
        error: summary.slice(0, 2000),
        reconnectPath: '/admin/dashboard',
      });
    } catch (error) {
      this.incidentOpen = false;
      this.logger.error(
        `supervisor alert failed: ${sanitizeOperationalText(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }
}
