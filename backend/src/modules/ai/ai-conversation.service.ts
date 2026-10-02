import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ConversationLockService } from '../../common/conversation-lock.service';
import {
  isValidRowId,
  updateReturningRows,
} from '../../common/db/raw-query-rows';
import { nextAllowedSendTime } from '../../common/time';
import { operationalEvent, sanitizeOperationalText } from '../../common/operational-log';
import { ClientOperationsService } from '../client-operations/client-operations.service';
import { ComplianceService } from '../compliance/compliance.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { Credential } from '../settings/credential.entity';
import { decryptIntegrationPayload } from '../integrations/integration-crypto';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationsService } from '../operations/operations.service';
import { AiRun } from './ai-run.entity';
import { AiAuditService } from './ai-audit.service';
import { AiConversationControlService } from './ai-conversation-control.service';
import { AiPolicyService } from './ai-policy.service';
import { AiToolService, AiToolResult } from './ai-tool.service';
import {
  AI_PROVIDER,
  AiProvider,
  AiProviderOutput,
  AiToolRequest,
} from './ai.types';
import { AiUsageService } from './ai-usage.service';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { ConversationAiState } from './conversation-ai-state.entity';
import { PlatformAiControl } from './platform-ai-control.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';
import { LimitsService } from '../limits/limits.service';
import { ProviderConfigService } from '../integrations/provider-config.service';

type AiConversationEvent = {
  tenantId: string;
  leadId: string;
  messageId: string | null;
  channel: 'sms' | 'email';
  triggerType: 'inbound' | 'first_response';
  // BUG 2 FIX: Controlled-test context must travel with the event, not be
  // re-inferred from a re-fetched lead. The worker's preflight re-fetch
  // was losing testRunId, causing SERVICE_NOT_ENTITLED for controlled tests.
  testRunId?: string | null;
};

type PreflightContext = {
  settings: WorkspaceAiSettings;
  knowledge: BrokerageKnowledge;
  state: ConversationAiState;
  lead: Lead;
  triggeringMessage: Message | null;
};

type PreflightDecision =
  | ({ allowed: true } & PreflightContext)
  | ({
      allowed: false;
      code: string;
      reason: string;
      priority: 'normal' | 'high' | 'urgent';
    } & Partial<PreflightContext>);

type EscalationContext = Pick<PreflightContext, 'settings' | 'state' | 'lead'> & {
  triggeringMessage: Message;
};

const AI_RUN_LEASE_SECONDS = 120;
const MAX_AI_RUN_ATTEMPTS = 3;

@Injectable()
export class AiConversationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AiConversationService.name);
  private readonly workerId = `ai-${process.env.HOSTNAME || process.pid}`;
  private workerTimer?: NodeJS.Timeout;
  private workerRunning = false;
  private lastPauseLogAt?: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AiRun)
    private readonly runs: Repository<AiRun>,
    @InjectRepository(WorkspaceAiSettings)
    private readonly settings: Repository<WorkspaceAiSettings>,
    @InjectRepository(BrokerageKnowledge)
    private readonly knowledge: Repository<BrokerageKnowledge>,
    @InjectRepository(ConversationAiState)
    private readonly states: Repository<ConversationAiState>,
    @InjectRepository(PlatformAiControl)
    private readonly platformControls: Repository<PlatformAiControl>,
    @InjectRepository(Lead)
    private readonly leads: Repository<Lead>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(Credential)
    private readonly credentials: Repository<Credential>,
    @Inject(AI_PROVIDER)
    private readonly provider: AiProvider,
    private readonly locks: ConversationLockService,
    private readonly control: AiConversationControlService,
    private readonly policy: AiPolicyService,
    private readonly tools: AiToolService,
    private readonly usage: AiUsageService,
    private readonly audit: AiAuditService,
    private readonly compliance: ComplianceService,
    private readonly entitlements: EntitlementService,
    private readonly clientOperations: ClientOperationsService,
    private readonly notifications: NotificationsService,
    private readonly operations: OperationsService,
    @Optional() private readonly limits?: LimitsService,
    @Optional() private readonly providerConfig?: ProviderConfigService,
  ) {}

  onModuleInit() {
    // Worker lifecycle observability: prove the worker timer is registered.
    this.logger.log(
      JSON.stringify({
        event: 'AI_WORKER_INIT',
        nodeEnv: process.env.NODE_ENV,
        willStartTimer: process.env.NODE_ENV !== 'test',
      }),
    );
    if (process.env.NODE_ENV === 'test') return;
    this.workerTimer = setInterval(() => {
      void this.tickWorker();
    }, 3_000);
    // Note: unref() removed — it was preventing the timer from firing in
    // the Railway staging environment. The timer must keep the worker alive.
  }

  /**
   * Runs one worker tick. Guarded so a slow tick can never overlap the next
   * one: overlapping ticks raced the exhausted-run recovery path and produced
   * duplicate "AI processing needs human follow-up" operations tasks (and
   * therefore duplicate notifications) during the 2026-09-26 rehearsal.
   */
  private async tickWorker() {
    // Diagnostic: prove tickWorker is being called
    this.logger.log(JSON.stringify({ event: 'AI_WORKER_TICK' }));
    if (this.workerRunning) return;
    this.workerRunning = true;
    try {
      await this.processPendingRuns(10);
    } catch (error: unknown) {
      this.logger.error(
        operationalEvent('ai_worker_failed', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      this.workerRunning = false;
    }
  }

  onModuleDestroy() {
    if (this.workerTimer) clearInterval(this.workerTimer);
  }

  /**
   * Called after a verified inbound provider event is durably stored and opt-out
   * handling is complete. This method never calls the model in the webhook
   * request; it only records a durable, idempotent job.
   */
  async acceptInbound(event: Omit<AiConversationEvent, 'triggerType'> & { messageId: string }) {
    const inboundEvent: AiConversationEvent = { ...event, triggerType: 'inbound' };
    const [lead, message, settings] = await Promise.all([
      this.leads.findOne({
        where: { id: event.leadId, tenantId: event.tenantId },
      }),
      this.messages.findOne({
        where: {
          id: event.messageId,
          leadId: event.leadId,
          direction: 'inbound',
        },
      }),
      this.settings.findOne({ where: { tenantId: event.tenantId } }),
    ]);
    if (!lead || !message) return { status: 'ignored' as const };

    const aiSettings = settings || (await this.defaultSettings(event.tenantId));
    const desiredDefault =
      aiSettings.aiEnabled && aiSettings.responseMode !== 'human_only'
        ? 'ai_handling'
        : 'human_handling';
    const state = await this.control.getOrCreateState(
      event.tenantId,
      event.leadId,
      desiredDefault,
    );

    if (
      !aiSettings.aiEnabled ||
      aiSettings.responseMode === 'human_only' ||
      aiSettings.aiPaused ||
      state.ownershipStatus !== 'ai_handling'
    ) {
      await this.notifyInboundForHuman(lead, message.id);
      return { status: 'stored_for_human' as const };
    }
    if (state.lastInboundMessageIdProcessed === message.id) {
      return { status: 'duplicate' as const };
    }

    const deterministicEscalation = this.policy.classifyInbound(message.body);
    if (deterministicEscalation) {
      const run = await this.createRun(inboundEvent, aiSettings.responseMode, 'blocked');
      if (run) {
        run.errorCode = deterministicEscalation.code;
        run.sanitizedError = deterministicEscalation.reason;
        await this.runs.save(run);
      }
      await this.escalate(
        {
          settings: aiSettings,
          state,
          lead,
          triggeringMessage: message,
        },
        deterministicEscalation.code,
        deterministicEscalation.reason,
        deterministicEscalation.priority,
      );
      return { status: 'escalated' as const };
    }

    const preflight = await this.preflight(inboundEvent);
    if (!preflight.allowed) {
      const run = await this.createRun(inboundEvent, aiSettings.responseMode, 'blocked');
      if (run) {
        run.errorCode = preflight.code;
        run.sanitizedError = preflight.reason;
        await this.runs.save(run);
      }
      await this.escalate(
        {
          settings: preflight.settings || aiSettings,
          state: preflight.state || state,
          lead: preflight.lead || lead,
          triggeringMessage: preflight.triggeringMessage || message,
        },
        preflight.code,
        preflight.reason,
        preflight.priority,
      );
      return { status: 'blocked' as const, code: preflight.code };
    }

    const run = await this.createRun(inboundEvent, aiSettings.responseMode, 'queued');
    return run
      ? { status: 'queued' as const, runId: run.id }
      : { status: 'duplicate' as const };
  }

  /** Queue the first AI response after lead intake without fabricating an
   * inbound message. The normal worker, controls, consent, provider readiness,
   * usage limits, quiet hours, and takeover locks still apply. */
  async acceptLead(event: { tenantId: string; leadId: string; testRunId?: string | null }) {
    const [lead, settings] = await Promise.all([
      this.leads.findOne({ where: { id: event.leadId, tenantId: event.tenantId } }),
      this.settings.findOne({ where: { tenantId: event.tenantId } }),
    ]);
    // Controlled-UAT observability: only emit checkpoints for test runs.
    // Prefer the explicitly passed testRunId (from tryAcceptLead) over
    // re-inferring from the re-fetched lead. The Lead entity has testRunId
    // persisted from intake(), but the explicit pass-through is the primary
    // source to avoid any re-fetch timing or caching loss.
    const testRunId = event.testRunId || (lead as any)?.testRunId as string | undefined;
    const isControlled = !!testRunId;
    if (isControlled) {
      this.logger.log(
        JSON.stringify({
          event: 'ACCEPT_LEAD_ENTERED',
          testRunId,
          tenantId: event.tenantId,
          leadId: event.leadId,
        }),
      );
    }
    if (
      !lead ||
      !settings?.aiEnabled ||
      settings.aiFirstResponderEnabled === false ||
      settings.aiPaused ||
      settings.responseMode === 'human_only'
    ) {
      return { status: 'ignored' as const, code: 'AI_NOT_ENABLED' };
    }
    const state = await this.control.getOrCreateState(
      event.tenantId,
      event.leadId,
      'ai_handling',
    );
    if (isControlled) {
      this.logger.log(
        JSON.stringify({
          event: 'STATE_READY',
          testRunId,
          tenantId: event.tenantId,
          leadId: event.leadId,
          stateId: (state as any)?.id,
          ownershipStatus: (state as any)?.ownershipStatus,
        }),
      );
    }
    if (state.ownershipStatus !== 'ai_handling') {
      return { status: 'ignored' as const, code: 'HUMAN_CONTROLLED' };
    }
    const allowedChannels = new Set(
      settings.allowedChannels?.length ? settings.allowedChannels : ['sms', 'email'],
    );
    const candidates: Array<'sms' | 'email'> = [];
    if (allowedChannels.has('email') && lead.emailEligible && lead.email) candidates.push('email');
    if (allowedChannels.has('sms') && lead.smsEligible && lead.phone) candidates.push('sms');
    let lastDenial: { channel: string; code: string; reason: string } | null = null;
    for (const channel of candidates) {
      const aiEvent: AiConversationEvent = {
        tenantId: event.tenantId,
        leadId: event.leadId,
        messageId: null,
        channel,
        triggerType: 'first_response',
        // BUG 2 FIX: Pass controlled-test context explicitly.
        testRunId: testRunId || null,
      };
      const preflight = await this.preflight(aiEvent);
      if (isControlled) {
        this.logger.log(
          JSON.stringify({
            event: 'PREFLIGHT_RESULT',
            testRunId,
            tenantId: event.tenantId,
            leadId: event.leadId,
            channel,
            passed: preflight.allowed,
            code: (preflight as any)?.code,
            reason: (preflight as any)?.reason,
            automationEnabled: settings?.aiEnabled,
            humanControl: state.ownershipStatus,
          }),
        );
      }
      if (!preflight.allowed) {
        // Diagnostic: log preflight denial so silent skips are observable.
        // Controlled UAT runs were silently skipping AI with no ai_run created.
        lastDenial = { channel, code: preflight.code, reason: preflight.reason };
        this.logger.warn(
          operationalEvent('ai_preflight_denied', {
            tenantId: event.tenantId,
            leadId: event.leadId,
            channel,
            code: preflight.code,
            reason: preflight.reason,
            triggerType: 'first_response',
          }),
        );
        continue;
      }
      if (isControlled) {
        this.logger.log(
          JSON.stringify({
            event: 'AI_RUN_CREATE_STARTED',
            testRunId,
            tenantId: event.tenantId,
            leadId: event.leadId,
            channel,
          }),
        );
      }
      let run: any = null;
      try {
        run = await this.createRun(aiEvent, settings.responseMode, 'queued');
      } catch (error: any) {
        if (isControlled) {
          this.logger.error(
            JSON.stringify({
              event: 'AI_RUN_CREATE_FAILED',
              testRunId,
              tenantId: event.tenantId,
              leadId: event.leadId,
              channel,
              errorType: error?.constructor?.name || typeof error,
              errorMessage: String(error?.message || error).slice(0, 200),
              operation: 'createRun',
            }),
          );
        }
        throw error;
      }
      if (isControlled && run) {
        this.logger.log(
          JSON.stringify({
            event: 'AI_RUN_PERSISTED',
            testRunId,
            tenantId: event.tenantId,
            leadId: event.leadId,
            channel,
            aiRunId: run.id,
            status: run.status,
            createdAt: run.createdAt,
          }),
        );
      }
      // Note: This system does not use a separate job queue. The ai_run is
      // persisted with status='queued'. A worker picks it up via claimRuns().
      // There is no AI_JOB_ENQUEUE step; dispatch = DB persistence.
      const result = run
        ? { status: 'queued' as const, runId: run.id, channel }
        : { status: 'duplicate' as const, channel };
      if (isControlled) {
        this.logger.log(
          JSON.stringify({
            event: 'ACCEPT_LEAD_RETURNING',
            testRunId,
            tenantId: event.tenantId,
            leadId: event.leadId,
            returnedStatus: result.status,
            aiRunId: (result as any)?.runId || null,
            // No separate job/dispatch ID: persistence IS the dispatch.
            dispatchMechanism: 'db_persisted_queued_status',
          }),
        );
      }
      return result;
    }
    return {
      status: 'ignored' as const,
      code: 'NO_ELIGIBLE_AI_CHANNEL',
      // Include the last preflight denial so callers can record it visibly.
      // Without this, denials are only in Railway logs, invisible in admin UI.
      denial: lastDenial,
    };
  }

  async processPendingRuns(limit = 10) {
    // Diagnostic: trace exact hang point
    this.logger.log(JSON.stringify({ event: 'AI_WORKER_STEP', step: 'enter_processPendingRuns' }));
    // Fix A: the worker must honor the platform emergency pause (and the
    // global automations kill-switch) BEFORE doing any recovery or claim
    // work. Previously recoverExhaustedRuns() ran unconditionally every
    // tick, so a paused platform still minted tasks/notifications.
    this.logger.log(JSON.stringify({ event: 'AI_WORKER_STEP', step: 'before_isWorkerPaused' }));
    const paused = await this.isWorkerPaused();
    this.logger.log(JSON.stringify({ event: 'AI_WORKER_STEP', step: 'after_isWorkerPaused', paused }));
    // Worker observability: log pause state and claim results so we can
    // prove whether the worker is polling and why runs aren't claimed.
    if (paused) {
      // Throttle: log pause state once per minute, not every 3s tick.
      const now = Date.now();
      if (!this.lastPauseLogAt || now - this.lastPauseLogAt > 60_000) {
        this.lastPauseLogAt = now;
        this.logger.warn(
          JSON.stringify({
            event: 'AI_WORKER_PAUSED',
            reason: 'isWorkerPaused=true',
            globalAutomationsDisabled: process.env.GLOBAL_AUTOMATIONS_DISABLED,
          }),
        );
      }
      return { claimed: 0, recovered: 0, paused: true as const };
    }
    const boundedLimit = Math.min(Math.max(limit, 1), 50);
    // BUG 1 FIX: recoverExhaustedRuns() must never permanently block the
    // worker loop. Wrap in timeout + try-catch isolation. If recovery hangs
    // or fails, log and continue to claimRuns().
    let recovered = 0;
    try {
      recovered = await this.withTimeout(
        this.recoverExhaustedRuns(boundedLimit),
        15000,
        'recoverExhaustedRuns',
      );
    } catch (recoveryError) {
      this.logger.error(
        JSON.stringify({
          event: 'AI_WORKER_RECOVERY_FAILED',
          error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
        }),
      );
      // Continue to claimRuns - recovery failure must not block polling.
    }
    this.logger.log(JSON.stringify({ event: 'AI_WORKER_STEP', step: 'before_claimRuns' }));
    const ids = await this.claimRuns(boundedLimit);
    this.logger.log(JSON.stringify({ event: 'AI_WORKER_STEP', step: 'after_claimRuns', count: ids.length }));
    if (ids.length > 0) {
      this.logger.log(
        JSON.stringify({
          event: 'AI_WORKER_CLAIMED',
          claimedCount: ids.length,
          claimedIds: ids,
          recovered,
        }),
      );
    }
    for (const id of ids) {
      // HARDENING: Instrument dispatch and isolate per-run failures.
      // A single run throwing must not kill the tick or orphan other runs.
      // Every claimed run must reach an explicit terminal/retry state.
      this.logger.log(
        JSON.stringify({
          event: 'PROCESS_DISPATCH_STARTED',
          runId: id,
        }),
      );
      try {
        const status = await this.processRun(id);
        // An early return (including a missing claim) is not completion.
        // Queued responses and drafts also retain their actual outcome.
        if (status) {
          this.logger.log(
            JSON.stringify({
              event: status === 'completed'
                ? 'PROCESS_RUN_COMPLETED'
                : 'PROCESS_RUN_OUTCOME',
              runId: id,
              status,
            }),
          );
        }
      } catch (dispatchError) {
        this.logger.error(
          JSON.stringify({
            event: 'PROCESS_DISPATCH_FAILED',
            runId: id,
            error:
              dispatchError instanceof Error
                ? dispatchError.message
                : String(dispatchError),
          }),
        );
        // blockRun conditionally writes failure only while this worker
        // still owns a processing run, even if ownership changes here.
        try {
          const failedRun = await this.runs.findOne({ where: { id } });
          if (failedRun) {
            await this.blockRun(
              failedRun,
              'WORKER_DISPATCH_ERROR',
              `Worker dispatch failed: ${dispatchError instanceof Error ? dispatchError.message : String(dispatchError)}`.slice(0, 500),
              'high',
              {},
              true, // providerFailure=true → status='failed'
            );
          }
        } catch (persistError) {
          this.logger.error(
            JSON.stringify({
              event: 'PROCESS_DISPATCH_FAILED_PERSIST_FAILED',
              runId: id,
              error:
                persistError instanceof Error
                  ? persistError.message
                  : String(persistError),
            }),
          );
        }
      }
    }
    return { claimed: ids.length, recovered, paused: false as const };
  }

  /**
   * True when the AI worker must not claim or recover any runs: the
   * platform emergency pause is active, or the global automations
   * kill-switch is set. Checked at the top of every worker tick, before
   * recoverExhaustedRuns/claimRuns/processRun.
   */
  /**
   * BUG 1 FIX: Timeout wrapper for worker operations. If the operation
   * does not complete within timeoutMs, reject with a timeout error.
   * Used to ensure recoverExhaustedRuns() can never permanently block
   * the worker loop.
   */
  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`${operationName}-timeout-after-${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  private async isWorkerPaused(): Promise<boolean> {
    if (process.env.GLOBAL_AUTOMATIONS_DISABLED === 'true') return true;
    // Timeout the DB query so a hanging connection doesn't stall the worker
    // forever. If the query times out, assume paused (fail-closed) and log.
    try {
      const control = await Promise.race([
        this.platformControls.findOne({ where: { id: 'global' } }),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('pause-check-timeout')), 5000),
        ),
      ]);
      return !!control?.paused;
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'AI_WORKER_PAUSE_CHECK_FAILED',
          error: error instanceof Error ? error.message : String(error),
          assumption: 'paused',
        }),
      );
      return true;
    }
  }

  private async recoverExhaustedRuns(limit: number) {
    // NOTE: the postgres driver returns [rows, rowCount] for UPDATE/DELETE
    // raw queries, NOT the rows array. updateReturningRows normalizes this;
    // iterating the raw tuple used to visit the inner array and the count
    // as "rows", yielding undefined ids and a task/notification per tick.
    const raw: unknown = await this.dataSource.transaction(async (manager) =>
      manager.query(
        `WITH candidates AS (
           SELECT id
           FROM ai_runs
           WHERE status IN ('queued', 'processing')
             AND attempt_count >= $2
             AND (
               status = 'queued'
               OR locked_at IS NULL
               OR locked_at < now() - ($1 * interval '1 second')
             )
           ORDER BY created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $3
         )
         UPDATE ai_runs AS run
         SET status = 'failed',
             error_code = 'AI_RUN_ATTEMPTS_EXHAUSTED',
             sanitized_error = 'AI processing was interrupted repeatedly and requires human review.',
             locked_at = NULL,
             locked_by = NULL
         FROM candidates
         WHERE run.id = candidates.id
         RETURNING run.id, run.tenant_id AS "tenantId", run.lead_id AS "leadId"`,
        [AI_RUN_LEASE_SECONDS, MAX_AI_RUN_ATTEMPTS, limit],
      ),
    );
    const rows =
      updateReturningRows<{ id: string; tenantId: string; leadId: string }>(
        raw,
      );
    let recovered = 0;
    for (const row of rows) {
      // Fix B: never use raw recovery results without runtime validation.
      // The declared TypeScript type does not reflect the raw DB result;
      // an absent identifier must not mint a task with an undefined dedupe
      // key (which is what produced the per-tick notification flood).
      if (
        !isValidRowId(row?.id) ||
        !isValidRowId(row?.tenantId) ||
        !isValidRowId(row?.leadId)
      ) {
        this.logger.error(
          operationalEvent('ai_worker_recovery_row_invalid', {
            // Bounded, sanitized incident: one log line per bad row, no
            // operations task, no notification, no retry loop.
            reason: 'recovered ai_run row is missing id/tenantId/leadId',
          }),
        );
        continue;
      }
      recovered++;
      await this.operations.createTask({
        tenantId: row.tenantId,
        category: 'ai_provider_failure',
        title: 'AI processing needs human follow-up',
        description:
          'AI processing was interrupted repeatedly. The inbound message remains stored and the conversation was escalated for human review.',
        priority: 'high',
        // Dedupe per lead (not per ai_run): each exhausted run used to mint
        // its own task, which is what flooded the queue with duplicates.
        // Fix C: createTask dedupes on (category, relatedEntityType,
        // relatedEntityId) = (ai_provider_failure, lead, leadId) with a
        // 24h throttle; a valid leadId is required for the dedupe key.
        relatedEntityType: 'lead',
        relatedEntityId: row.leadId,
        evidenceNote: `Exhausted ai_run ${row.id}`,
        dedupeOpen: true,
        throttleHours: 24,
      });
      await this.control.markWaitingForHuman(
        row.tenantId,
        row.leadId,
        'AI processing was interrupted repeatedly. Review the latest inbound message and respond personally.',
        'high',
      );
    }
    return recovered;
  }

  private claimRuns(limit: number): Promise<string[]> {
    // Same driver-shape note as recoverExhaustedRuns: UPDATE returns
    // [rows, rowCount]; mapping the raw tuple produced [undefined, ...]
    // so no run was ever actually claimed.
    return this.dataSource.transaction(async (manager) => {
      const raw: unknown = await manager.query(
        `WITH candidates AS (
           SELECT id
           FROM ai_runs
           WHERE status IN ('queued', 'processing')
             AND attempt_count < $4
             AND (
               status = 'queued'
               OR locked_at IS NULL
               OR locked_at < now() - ($1 * interval '1 second')
             )
           ORDER BY created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE ai_runs AS run
         SET status = 'processing',
             locked_at = now(),
             locked_by = $3,
             attempt_count = run.attempt_count + 1
         FROM candidates
         WHERE run.id = candidates.id
         RETURNING run.id`,
        [AI_RUN_LEASE_SECONDS, limit, this.workerId, MAX_AI_RUN_ATTEMPTS],
      );
      return updateReturningRows<{ id: string }>(raw)
        .map((row) => row?.id)
        .filter(isValidRowId);
    });
  }

  private async processRun(
    runId: string,
  ): Promise<'completed' | 'drafted' | 'response_queued' | void> {
    // HARDENING: Instrument the claim→process handoff. Every claimed run
    // must produce an observable outcome — it must not silently disappear.
    this.logger.log(
      JSON.stringify({
        event: 'PROCESS_RUN_ENTERED',
        runId,
        workerId: this.workerId,
      }),
    );
    // DIAGNOSTIC: Time each awaited operation to identify hangs. Each step
    // logs start/end with duration. If a step never logs END, that's the stall.
    const timed = async <T>(step: string, fn: () => Promise<T> | T): Promise<T> => {
      const start = Date.now();
      this.logger.log(JSON.stringify({ event: 'PROCESS_STEP_START', runId, step }));
      try {
        const result = await fn();
        this.logger.log(
          JSON.stringify({ event: 'PROCESS_STEP_END', runId, step, durationMs: Date.now() - start }),
        );
        return result;
      } catch (error) {
        // SANITIZE BEFORE TRUNCATION: extract error code/message safely without
        // leaking PII, SQL, or model output. Never log raw error objects.
        const safeError =
          error instanceof Error
            ? { code: (error as any).code || 'UNKNOWN', message: error.message.slice(0, 200) }
            : { code: 'UNKNOWN', message: String(error).slice(0, 200) };
        this.logger.error(
          JSON.stringify({
            event: 'PROCESS_STEP_ERROR',
            runId,
            step,
            durationMs: Date.now() - start,
            errorCode: safeError.code,
            error: safeError.message,
          }),
        );
        throw error;
      }
    };
    const run = await timed('run_lookup', () =>
      this.runs.findOne({
        where: { id: runId, lockedBy: this.workerId },
      }),
    );
    if (!run) {
      // HARDENING: The silent `return` here was the exact line where the
      // 2026-09-28 fresh UAT run (900c6a4f-...) disappeared after a successful
      // claim. A claimed run that cannot be re-fetched is an observable
      // failure, not a silent skip. Attempt to locate the run by ID alone to
      // determine whether the lock was lost, and record the outcome.
      const orphan = await this.runs.findOne({ where: { id: runId } });
      this.logger.error(
        JSON.stringify({
          event: 'PROCESS_RUN_FAILED',
          runId,
          reason: 'run_not_found_after_claim',
          workerId: this.workerId,
          orphanFound: !!orphan,
          orphanStatus: (orphan as any)?.status || null,
          orphanLockedBy: (orphan as any)?.lockedBy || null,
        }),
      );
      // If the run exists but is not locked by us, do not process it —
      // another worker owns it. If it does not exist at all, there is
      // nothing to update. Either way, the failure is now observable.
      return;
    }
    const event: AiConversationEvent = {
      tenantId: run.tenantId,
      leadId: run.leadId,
      messageId: run.triggeringMessageId,
      channel:
        run.promptMetadata?.channel === 'email' ? 'email' : 'sms',
      triggerType: run.triggerType || 'inbound',
      // BUG 2 FIX: Read controlled-test identity from the ai_run's
      // promptMetadata (persisted at creation), not from re-inferring
      // via the lead. This ensures worker preflight matches acceptLead
      // preflight for the same controlled test.
      testRunId: (run.promptMetadata as any)?.testRunId || null,
    };
    const triggeringMessageId = run.triggeringMessageId;
    const trigger = triggeringMessageId
      ? await timed('trigger_message_lookup', () =>
          this.messages.findOne({
            where: { id: triggeringMessageId, leadId: run.leadId },
          }),
        )
      : null;
    if (trigger) event.channel = trigger.channel;

    const preflight = await timed('preflight', () => this.preflight(event));
    if (!preflight.allowed) {
      await this.blockRun(
        run,
        preflight.code,
        preflight.reason,
        preflight.priority,
        preflight,
      );
      return;
    }
    const resumeMaxAgeMinutes = safeResumeMaxAgeMinutes();
    if (
      run.createdAt &&
      Date.now() - new Date(run.createdAt).getTime() > resumeMaxAgeMinutes * 60_000
    ) {
      await this.blockRun(
        run,
        'STALE_AUTOMATION',
        `AI response is more than ${resumeMaxAgeMinutes} minutes overdue and requires human review instead of replay.`,
        'high',
        preflight,
      );
      return;
    }

    try {
      const recentMessages = await timed('context_messages', () => this.contextMessages(run.leadId));
      const firstAiResponse =
        (await timed('outbound_count', () =>
          this.messages.count({
            where: {
              leadId: run.leadId,
              direction: 'outbound',
              authorship: 'ai',
            },
          }),
        )) === 0;
      run.promptMetadata = {
        channel: event.channel,
        messageCount: recentMessages.length,
        contextCharacters: recentMessages.reduce(
          (sum, message) => sum + message.body.length,
          0,
        ),
        knowledgeVersion: preflight.knowledge.updatedAt?.toISOString() || null,
        firstAiResponse,
        triggerType: run.triggerType,
        // Preserve controlled-test identity across promptMetadata replacement.
        // Without this, a retry reconstructs the event from promptMetadata
        // (line ~795) and loses the testRunId, causing SERVICE_NOT_ENTITLED.
        ...(event.testRunId ? { testRunId: event.testRunId } : {}),
      };
      await this.runs.save(run);

      const usageReservation = await timed('quota_reservation', () =>
        this.limits?.reserveUsage({
          tenantId: run.tenantId,
          metric: 'ai',
          idempotencyKey: `ai-run:${run.id}`,
        }),
      );
      if (usageReservation && !usageReservation.ok) {
        await this.blockRun(
          run,
          usageReservation.code,
          usageReservation.message,
          'urgent',
          preflight,
        );
        return;
      }

      const result = await timed('provider_generate', () => this.provider.generate({
        mode: run.mode,
        channel: event.channel,
        identityLabel: preflight.settings.identityLabel as string,
        firstAiResponse,
        lead: this.providerLeadContext(preflight.lead),
        conversationSummary: preflight.lead.conversationSummary || null,
        triggeringMessage: preflight.triggeringMessage
          ? {
              direction: preflight.triggeringMessage.direction as
                | 'inbound'
                | 'outbound',
              channel: preflight.triggeringMessage.channel as 'sms' | 'email',
              body: preflight.triggeringMessage.body.slice(0, 2_000),
              authorship:
                preflight.triggeringMessage.authorship || 'system',
              createdAt: preflight.triggeringMessage.createdAt.toISOString(),
            }
          : null,
        recentMessages,
        knowledge: preflight.knowledge,
        settings: preflight.settings,
      }));
      run.provider = result.provider;
      run.model = result.model;
      run.confidence = result.confidence;
      run.inputUsage = result.inputUsage;
      run.outputUsage = result.outputUsage;
      run.estimatedCostUsd = this.usage.estimateCost(
        result.inputUsage,
        result.outputUsage,
      );
      run.latencyMs = result.latencyMs;
      run.structuredResponse = {
        reply: result.reply,
        confidence: result.confidence,
        classification: result.classification,
        escalationReason: result.escalationReason,
        summary: result.summary,
        recommendedNextAction: result.recommendedNextAction,
        leadTemperature: result.leadTemperature,
      };
      run.requestedTools = result.actions;
      await timed('post_provider_save', () => this.runs.save(run));

      const output: AiProviderOutput = {
        reply: result.reply
          ? this.policy.ensureRequiredDisclaimer(
              this.policy.ensureIdentityDisclosure(
                result.reply,
                preflight.settings.identityLabel as string,
                firstAiResponse,
              ),
              preflight.knowledge.requiredDisclaimer,
            )
          : null,
        confidence: result.confidence,
        classification: result.classification,
        escalationReason: result.escalationReason,
        summary: result.summary,
        recommendedNextAction: result.recommendedNextAction,
        leadTemperature: result.leadTemperature,
        actions: result.actions,
      };
      if (output.classification === 'handoff' || output.escalationReason) {
        // ROUTINE BUYER OVERRIDE: If this is a routine buyer inquiry with
        // extractable facts, do NOT handoff. The model is incorrectly
        // escalating instead of handling the inquiry. Override the handoff
        // and continue through the buyer-intake path. Preserve the original
        // model decision in the audit trail.
        const buyerFactsForOverride = this.extractBuyerFacts(
          preflight.triggeringMessage?.body || null,
        );
        if (buyerFactsForOverride) {
          this.logger.log(
            JSON.stringify({
              event: 'HANDOFF_OVERRIDDEN_ROUTINE_BUYER',
              runId: run.id,
              originalClassification: output.classification,
              originalEscalationReason:
                output.escalationReason?.slice(0, 200) || null,
            }),
          );
          // Clear the handoff so processing continues
          output.classification = 'allowed';
          output.escalationReason = null;
        } else {
          await timed('blockrun_handoff', () =>
            this.blockRun(
              run,
              'MODEL_REQUESTED_HANDOFF',
              output.escalationReason ||
                'The AI determined that a human should handle this conversation.',
              'high',
              preflight,
            ),
          );
          return;
        }
      }
      if (output.confidence < preflight.settings.minimumConfidenceThreshold) {
        await timed('blockrun_low_confidence', () =>
          this.blockRun(
            run,
            'LOW_CONFIDENCE',
            'The AI response did not meet the workspace confidence threshold.',
            'high',
            preflight,
          ),
        );
        return;
      }
      const requested = this.withRequiredOperationalUpdates(
        output,
        preflight.triggeringMessage?.body || null,
      );
      const toolResults: AiToolResult[] = [];
      let verifiedBookingLink: string | null = null;
      let calendarBookingConfirmed = false;
      for (let index = 0; index < requested.length; index += 1) {
        const toolName = requested[index].name;
        // SCHEDULING INTENT ENFORCEMENT: Block booking tools for listing-only
        // requests. A request for listings is not a booking request.
        const isBookingTool =
          toolName === 'send_verified_booking_link' ||
          toolName === 'create_or_update_appointment';
        if (
          isBookingTool &&
          !this.hasSchedulingIntent(preflight.triggeringMessage?.body || null)
        ) {
          this.logger.log(
            JSON.stringify({
              event: 'TOOL_BLOCKED_NO_SCHEDULING_INTENT',
              runId: run.id,
              tool: toolName,
            }),
          );
          toolResults.push({
            status: 'blocked',
            name: toolName as 'send_verified_booking_link' | 'create_or_update_appointment',
            idempotencyKey: `blocked:${run.id}:${toolName}:${index}`,
            code: 'NO_SCHEDULING_INTENT',
            reason:
              'Booking tools require explicit scheduling intent. A listing request is not a booking request.',
          });
          continue;
        }
        const toolResult = await timed(`tool_execute_${index}`, () =>
          this.tools.execute(
            {
              run,
              lead: preflight.lead,
              triggeringMessage: preflight.triggeringMessage,
              settings: preflight.settings,
              knowledge: preflight.knowledge,
              state: preflight.state,
              channel: event.channel,
            },
            requested[index],
            index,
          ),
        );
        toolResults.push(toolResult);
        run.executedTools = toolResults.filter(
          (item) => item.status === 'executed',
        ) as unknown as Array<Record<string, unknown>>;
        run.blockedTools = toolResults.filter(
          (item) => item.status === 'blocked',
        ) as unknown as Array<Record<string, unknown>>;
        await timed('tool_result_save', () => this.runs.save(run));
        if (toolResult.status === 'blocked') {
          // OBSERVABILITY: A blocked tool kills the run via blockRun, which
          // emits no log line for non-provider failures. Log it here so a
          // blocked run is always visible in application logs. The arg shape
          // (keys and value types, never values) is included so a contract
          // mismatch can be diagnosed without leaking lead PII into logs.
          const blockedRequest = requested[index] as
            | { arguments?: unknown }
            | undefined;
          this.logger.warn(
            JSON.stringify({
              event: 'PROCESS_TOOL_BLOCKED',
              runId: run.id,
              leadId: run.leadId,
              toolName: toolResult.name,
              code: toolResult.code || 'AI_TOOL_BLOCKED',
              reason: (toolResult.reason || 'An AI tool did not pass validation.').slice(0, 300),
              argShape: describeToolArgShape(blockedRequest?.arguments),
            }),
          );
          await this.blockRun(
            run,
            toolResult.code || 'AI_TOOL_BLOCKED',
            toolResult.reason || 'An AI tool did not pass validation.',
            'high',
            preflight,
          );
          return;
        }
        if (typeof toolResult.output?.bookingLink === 'string') {
          verifiedBookingLink = toolResult.output.bookingLink;
        }
        if (
          toolResult.name === 'create_or_update_appointment' &&
          toolResult.status === 'executed' &&
          typeof toolResult.output?.appointmentId === 'string'
        ) {
          calendarBookingConfirmed = true;
        }
      }
      if (verifiedBookingLink && output.reply) {
        if (!output.reply.includes(verifiedBookingLink)) {
          output.reply = `${output.reply}\n\nBook a time: ${verifiedBookingLink}`;
        }
      }
      if (preflight.state.ownershipStatus !== 'ai_handling') {
        run.status = 'completed';
        run.lockedAt = null;
        run.lockedBy = null;
        await this.runs.save(run);
        return 'completed';
      }

      const validation = this.policy.validateResponse({
        output,
        settings: preflight.settings,
        knowledge: preflight.knowledge,
        identityLabel: preflight.settings.identityLabel as string,
        firstAiResponse,
        channel: event.channel,
        verifiedBookingLink,
        calendarBookingConfirmed,
      });
      if (!validation.allowed) {
        await this.blockRun(
          run,
          validation.code || 'AI_RESPONSE_BLOCKED',
          validation.reason || 'The AI response did not pass validation.',
          'high',
          preflight,
        );
        return;
      }
      if (validation.noReply || !output.reply) {
        await timed('complete_without_reply', () =>
          this.completeWithoutReply(run, preflight),
        );
        return 'completed';
      }

      const body =
        event.channel === 'email'
          ? `${output.reply}\n\nUnsubscribe: {{unsubscribeUrl}}`
          : output.reply;
      const message = await timed('finalize_message', () =>
        this.finalizeMessage(
          run,
          preflight,
          event.channel,
          body,
          Boolean(verifiedBookingLink),
        ),
      );
      run.status =
        run.mode === 'draft' ? 'drafted' : 'response_queued';
      run.lockedAt = null;
      run.lockedBy = null;
      await timed('queue_outcome_save', () => this.runs.save(run));
      await timed('audit_response_prepared', () =>
        this.audit.recordSystem(run.leadId, 'ai_response_prepared', {
          runId: run.id,
          messageId: message.id,
          mode: run.mode,
          status: message.status,
          confidence: run.confidence,
          requestedTools: run.requestedTools.map((item: any) => item.name),
          executedTools: run.executedTools.map((item: any) => item.name),
        }),
      );
      if (run.mode === 'draft') {
        await this.notifications.createForTenant({
          tenantId: run.tenantId,
          assignedUserId: preflight.lead.assignedToUserId,
          eventType: 'ai.draft_ready',
          category: 'leads',
          severity: 'info',
          title: `Draft ready for ${preflight.lead.fullName}`,
          message: 'Review, edit, approve, reject, or take over the conversation.',
          deduplicationKey: `ai-draft:${message.id}`,
          actionUrl: `/app/inbox?leadId=${preflight.lead.id}`,
          entityType: 'message',
          entityId: message.id,
        });
      }
      return run.mode === 'draft' ? 'drafted' : 'response_queued';
    } catch (error: any) {
      const sanitized = sanitizeOperationalText(
        error?.response?.message || error?.message || 'AI provider failed',
      ).slice(0, 1_000);
      await timed('blockrun_catch', () =>
        this.blockRun(
          run,
          String(error?.response?.code || error?.code || 'AI_PROVIDER_FAILED'),
          sanitized,
          'high',
          preflight,
          true,
        ),
      );
    }
  }

  private async preflight(event: AiConversationEvent): Promise<PreflightDecision> {
    const [settings, knowledge, lead, trigger, control] = await Promise.all([
      this.settings.findOne({ where: { tenantId: event.tenantId } }),
      this.knowledge.findOne({ where: { tenantId: event.tenantId } }),
      this.leads.findOne({
        where: { id: event.leadId, tenantId: event.tenantId },
      }),
      event.messageId
        ? this.messages.findOne({
            where: {
              id: event.messageId,
              leadId: event.leadId,
              direction: 'inbound',
            },
          })
        : Promise.resolve(null),
      this.platformControls.findOne({ where: { id: 'global' } }),
    ]);
    const state = await this.control.getOrCreateState(
      event.tenantId,
      event.leadId,
    );
    const deny = (
      code: string,
      reason: string,
      priority: 'normal' | 'high' | 'urgent' = 'high',
    ): PreflightDecision => ({
      allowed: false,
      code,
      reason,
      priority,
      settings: settings || undefined,
      knowledge: knowledge || undefined,
      state,
      lead: lead || undefined,
      triggeringMessage: trigger || undefined,
    });
    if (!settings || !lead || (event.triggerType === 'inbound' && !trigger)) {
      return deny('AI_CONTEXT_MISSING', 'Required AI conversation context is unavailable.');
    }
    if (control?.paused) {
      return deny('PLATFORM_AI_PAUSED', control.reason || 'Platform AI is paused.');
    }
    if (
      !settings.aiEnabled ||
      settings.aiPaused ||
      settings.responseMode === 'human_only'
    ) {
      return deny(
        'WORKSPACE_AI_PAUSED',
        settings.aiPausedReason || 'Workspace AI is disabled or paused.',
      );
    }
    const allowedChannels = settings.allowedChannels?.length
      ? settings.allowedChannels
      : ['sms', 'email'];
    if (!allowedChannels.includes(event.channel)) {
      return deny(
        'AI_CHANNEL_NOT_ALLOWED',
        `AI is not approved for ${event.channel} in this workspace.`,
        'normal',
      );
    }
    if (state.ownershipStatus !== 'ai_handling') {
      return deny(
        'CONVERSATION_NOT_AI_CONTROLLED',
        'The conversation is controlled by a human.',
        'normal',
      );
    }
    if (trigger && state.lastInboundMessageIdProcessed === trigger.id) {
      return deny('DUPLICATE_INBOUND', 'The inbound message was already processed.', 'normal');
    }
    if (
      settings.configurationApprovalStatus !== 'approved' ||
      !settings.identityLabel?.trim()
    ) {
      return deny(
        'AI_CONFIGURATION_NOT_APPROVED',
        'AI identity and workspace settings are not approved.',
      );
    }
    if (!knowledge || knowledge.approvalStatus !== 'approved') {
      return deny(
        'KNOWLEDGE_NOT_APPROVED',
        'Verified brokerage information is unavailable or unapproved.',
      );
    }
    if (state.aiTurnCount >= settings.maximumAutomaticTurns) {
      return deny(
        'MAXIMUM_AI_TURNS_REACHED',
        'The conversation reached its maximum consecutive AI turns.',
      );
    }
    const entitlement = await this.entitlements.evaluate(
      event.tenantId,
      event.channel === 'sms'
        ? 'send_automated_sms'
        : 'send_automated_email',
      new Date(),
      // BUG 2 FIX: Prefer the explicit event.testRunId (carried from
      // acceptLead via ai_run.promptMetadata) over re-inferring from the
      // re-fetched lead. This ensures worker preflight matches acceptLead
      // preflight for controlled tests. Falls back to lead.testRunId for
      // backward compatibility with runs created before this fix.
      { controlledTest: Boolean(event.testRunId || lead.testRunId) },
    );
    if (!entitlement.allowed) {
      return deny('SERVICE_NOT_ENTITLED', entitlement.reasons.join('; '));
    }
    const consent = await this.compliance.communicationEligibility(
      event.tenantId,
      lead,
      event.channel,
    );
    if (!consent.allowed) {
      return deny(
        consent.code || 'MISSING_CONSENT',
        consent.reason || 'Consent is not valid.',
      );
    }
    const provider = event.channel === 'sms' ? 'twilio' : 'sendgrid';
    const integration = this.providerConfig
      ? event.channel === 'sms'
        ? await this.providerConfig.resolveTwilio(event.tenantId, {
            allowTesting: Boolean(lead.testRunId),
          })
        : await this.providerConfig.resolveSendGrid(event.tenantId, {
            allowTesting: Boolean(lead.testRunId),
          })
      : await this.legacyProviderConfiguration(event.tenantId, provider);
    if (!integration || ('connected' in integration && !integration.connected)) {
      return deny(
        'MESSAGE_PROVIDER_NOT_READY',
        `${provider} is not connected and tested for this workspace.`,
      );
    }
    if (!String(process.env.OPENAI_API_KEY || '').trim()) {
      return deny('AI_PROVIDER_NOT_CONFIGURED', 'The AI provider is not configured.');
    }
    const limits = await this.usage.evaluateLimits(settings, state);
    if (!limits.allowed) {
      return deny(
        limits.code || 'AI_USAGE_LIMIT',
        limits.reason || 'AI usage limit reached.',
      );
    }
    return {
      allowed: true,
      settings,
      knowledge,
      state,
      lead,
      triggeringMessage: trigger,
    };
  }

  private async legacyProviderConfiguration(
    tenantId: string,
    provider: 'twilio' | 'sendgrid',
  ) {
    const credential = await this.credentials.findOne({
      where: { provider, tenant: { id: tenantId } as any },
      relations: ['tenant'],
    });
    return credential ? decryptIntegrationPayload(credential.encryptedValue) : null;
  }

  private async createRun(
    event: AiConversationEvent,
    mode: WorkspaceAiSettings['responseMode'],
    status: AiRun['status'],
  ) {
    const existing = await this.runs.findOne({
      where: event.messageId
        ? { triggeringMessageId: event.messageId }
        : { leadId: event.leadId, triggerType: 'first_response' },
    });
    if (existing) return null;
    try {
      return await this.runs.save(
        this.runs.create({
          tenantId: event.tenantId,
          leadId: event.leadId,
          triggeringMessageId: event.messageId,
          triggerType: event.triggerType,
          provider: 'openai',
          mode,
          status,
          promptMetadata: {
            channel: event.channel,
            triggerType: event.triggerType,
            contentsStored: false,
            // BUG 2 FIX: Persist controlled-test identity on the ai_run so
            // the worker does not need to re-infer it from the lead.
            ...(event.testRunId ? { testRunId: event.testRunId } : {}),
          },
          requestedTools: [],
          executedTools: [],
          blockedTools: [],
          inputUsage: 0,
          outputUsage: 0,
          attemptCount: 0,
        }),
      );
    } catch (error: any) {
      if (String(error?.code || '') === '23505') return null;
      throw error;
    }
  }

  private async defaultSettings(tenantId: string) {
    try {
      return await this.settings.save(
        this.settings.create({
          tenantId,
          aiEnabled: false,
          responseMode: 'controlled_autopilot',
          maximumAutomaticTurns: 12,
          minimumConfidenceThreshold: 0.82,
          perConversationUsageLimit: 12_000,
          monthlyWorkspaceUsageLimit: 500_000,
          aiPaused: false,
          configurationApprovalStatus: 'draft',
          lastConfigurationUpdate: new Date(),
        }),
      );
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      return this.settings.findOneOrFail({ where: { tenantId } });
    }
  }

  private async contextMessages(leadId: string) {
    const configured = Number(process.env.AI_MAX_CONTEXT_CHARACTERS || 12_000);
    const maxCharacters =
      Number.isInteger(configured) && configured >= 2_000 && configured <= 40_000
        ? configured
        : 12_000;
    const rows = await this.messages.find({
      where: [
        { leadId, direction: 'inbound' },
        { leadId, direction: 'outbound', status: In(['provider_accepted', 'sent', 'delivered']) },
      ],
      order: { createdAt: 'DESC' },
      take: 20,
    });
    let used = 0;
    const selected: Message[] = [];
    for (const row of rows) {
      const body = row.body.slice(0, 2_000);
      if (selected.length >= 12 || used + body.length > maxCharacters) break;
      used += body.length;
      selected.push(Object.assign(row, { body }));
    }
    return selected.reverse().map((message) => ({
      direction: message.direction,
      channel: message.channel,
      body: message.body,
      authorship: message.authorship || 'system',
      createdAt: message.createdAt.toISOString(),
    }));
  }

  private providerLeadContext(lead: Lead) {
    return {
      id: lead.id,
      fullName: lead.fullName,
      leadType: lead.leadType,
      stage: lead.stage,
      location: lead.location || null,
      propertyInterest: lead.propertyInterest || null,
      timeline: lead.timeline || null,
      budget: lead.budgetRange || lead.estimatedPrice || null,
      preapproved: lead.preapproved || null,
      preferredAreas: lead.preferredAreas || [],
      bestTimeToTalk: lead.bestTimeToTalk || null,
      temperature: lead.temperature,
      readiness: lead.readinessLevel,
      qualificationData: lead.qualificationData || {},
      recommendedNextAction: lead.recommendedNextAction || null,
    };
  }

  /**
   * Extract buyer qualification facts from the triggering message.
   * Returns null if the message is not a buyer inquiry or facts cannot be
   * extracted with confidence. Only extracts explicitly stated facts;
   * never invents values.
   */
  /**
   * Detect if a message contains explicit scheduling intent.
   * Returns true only for clear appointment/viewing requests.
   * A request for listings is NOT scheduling intent.
   */
  private hasSchedulingIntent(messageBody: string | null): boolean {
    if (!messageBody) return false;
    const body = messageBody.toLowerCase();
    const schedulingPhrases = [
      'schedule a viewing',
      'schedule a tour',
      'book a viewing',
      'book a tour',
      'schedule an appointment',
      'book an appointment',
      'can we meet',
      'when can i see',
      'available to view',
      'set up a viewing',
    ];
    return schedulingPhrases.some((phrase) => body.includes(phrase));
  }

  private extractBuyerFacts(
    triggeringMessageBody: string | null,
  ): { intent: string; location: string | null; budget: string | null } | null {
    if (!triggeringMessageBody) return null;
    const body = triggeringMessageBody.toLowerCase();

    // Buyer inquiry indicators: mentions homes, areas, budgets, listings, bedrooms
    const buyerIndicators = [
      'looking for',
      'bedroom',
      'bedrooms',
      'listings',
      'budget',
      ' Elmwood '.toLowerCase(), // Will be generalized
      'house',
      'home',
      'apartment',
      'condo',
    ];
    const isBuyerInquiry = buyerIndicators.some((indicator) =>
      body.includes(indicator),
    );
    if (!isBuyerInquiry) return null;

    // Extract location: look for "in <Place>" pattern
    // This is a simple heuristic; the model should do the primary extraction
    let location: string | null = null;
    const locationMatch = triggeringMessageBody.match(
      /\bin\s+([A-Z][a-zA-Z\s]+?)(?:,|\.|\s+budget|\s+with|\s*$)/i,
    );
    if (locationMatch) {
      location = locationMatch[1].trim();
    }

    // Extract budget: look for $ amounts or "budget <amount>"
    let budget: string | null = null;
    const budgetMatch = triggeringMessageBody.match(
      /budget\s*\$?([\d,]+k?)/i,
    );
    if (budgetMatch) {
      let amount = budgetMatch[1];
      if (amount.toLowerCase().endsWith('k')) {
        const num = parseFloat(amount.slice(0, -1));
        if (!isNaN(num)) {
          amount = `$${(num * 1000).toLocaleString()}`;
        }
      } else {
        amount = `$${parseFloat(amount.replace(/,/g, '')).toLocaleString()}`;
      }
      budget = amount;
    }

    // Only return if we have at least intent + one fact
    if (!location && !budget) return null;

    return {
      intent: 'buyer',
      location,
      budget,
    };
  }

  private withRequiredOperationalUpdates(
    output: AiProviderOutput,
    triggeringMessageBody: string | null,
  ) {
    const actions = [...output.actions];
    const add = (name: AiToolRequest['name'], args: Record<string, unknown>) => {
      if (!actions.some((action) => action.name === name)) {
        actions.push({ name, arguments: JSON.stringify(args) });
      }
    };
    // QUALIFICATION PERSISTENCE: If this is a buyer inquiry and the model
    // did not call update_lead_qualification, extract facts from the triggering
    // message and add the tool call. This ensures buyer facts are persisted
    // even when the model omits the action.
    const buyerFacts = this.extractBuyerFacts(triggeringMessageBody);
    if (buyerFacts) {
      const qualification: Record<string, string | null> = {
        intent: buyerFacts.intent,
      };
      if (buyerFacts.location) qualification.location = buyerFacts.location;
      if (buyerFacts.budget) qualification.budget = buyerFacts.budget;
      add('update_lead_qualification', { qualification });
    }
    if (output.summary.trim()) {
      add('update_conversation_summary', { summary: output.summary });
    }
    if (output.recommendedNextAction.trim()) {
      add('set_next_action', {
        nextAction: output.recommendedNextAction,
      });
    }
    if (output.leadTemperature !== 'unchanged') {
      add('set_lead_temperature', {
        temperature: output.leadTemperature,
        reason: output.summary || 'Updated from the current conversation.',
      });
    }
    return actions.slice(0, 10);
  }

  private async finalizeMessage(
    run: AiRun,
    context: PreflightContext,
    channel: 'sms' | 'email',
    body: string,
    requiresBookingLink: boolean,
  ) {
    return this.locks.withLock(run.tenantId, run.leadId, async () => {
      const [state, settings, existing, latestInboundEmail] = await Promise.all([
        this.states.findOne({
          where: { tenantId: run.tenantId, leadId: run.leadId },
        }),
        this.settings.findOne({ where: { tenantId: run.tenantId } }),
        this.messages.findOne({
          where: { idempotencyKey: `ai:${run.id}` },
        }),
        channel === 'email'
          ? this.messages.findOne({
              where: {
                leadId: run.leadId,
                channel: 'email',
                direction: 'inbound',
              },
              order: { createdAt: 'DESC' },
            })
          : Promise.resolve(null),
      ]);
      if (existing) return existing;
      if (
        !state ||
        state.ownershipStatus !== 'ai_handling' ||
        !settings?.aiEnabled ||
        settings.aiPaused
      ) {
        throw Object.assign(new Error('Conversation changed before AI response was queued'), {
          code: 'CONVERSATION_STATE_CHANGED',
        });
      }
      const quiet = await this.compliance.getQuietHours(run.tenantId);
      const now = new Date();
      // Controlled UAT test leads bypass quiet-hours scheduling so the E2E
      // rehearsal can verify the full send path without waiting for the
      // quiet-hours window to end. Production leads still respect quiet hours.
      const isControlledTest = Boolean(context.lead?.testRunId);
      const scheduledAt = !isControlledTest && quiet.enabled
        ? nextAllowedSendTime({
            now,
            timeZone: quiet.timezone,
            quietStart: `${String(Math.floor(quiet.startMinute / 60)).padStart(2, '0')}:${String(quiet.startMinute % 60).padStart(2, '0')}`,
            quietEnd: `${String(Math.floor(quiet.endMinute / 60)).padStart(2, '0')}:${String(quiet.endMinute % 60).padStart(2, '0')}`,
          })
        : now;
      const message = await this.messages.save(
        this.messages.create({
          leadId: run.leadId,
          channel,
          direction: 'outbound',
          body,
          subject:
            channel === 'email'
              ? replySubject(latestInboundEmail?.subject)
              : null,
          inReplyToProviderMessageId:
            channel === 'email'
              ? latestInboundEmail?.providerMessageId || null
              : null,
          status: run.mode === 'draft' ? 'draft' : 'queued',
          scheduledAt:
            run.mode === 'draft' || scheduledAt <= now ? undefined : scheduledAt,
          attemptCount: 0,
          idempotencyKey: `ai:${run.id}`,
          authorship: 'ai',
          aiRunId: run.id,
          communicationType: channel,
          requiresBookingLink,
        }),
      );
      if (run.triggeringMessageId) {
        state.lastInboundMessageIdProcessed = run.triggeringMessageId;
      }
      state.lastAiResponseId = message.id;
      state.aiTurnCount += 1;
      state.usageUnits += run.inputUsage + run.outputUsage;
      await this.states.save(state);
      return message;
    });
  }

  private async completeWithoutReply(run: AiRun, context: PreflightContext) {
    if (run.triggeringMessageId) {
      context.state.lastInboundMessageIdProcessed = run.triggeringMessageId;
    }
    context.state.usageUnits += run.inputUsage + run.outputUsage;
    await this.states.save(context.state);
    run.status = 'completed';
    run.lockedAt = null;
    run.lockedBy = null;
    await this.runs.save(run);
    await this.audit.recordSystem(run.leadId, 'ai_run_completed_without_reply', {
      runId: run.id,
      classification: run.structuredResponse?.classification || 'no_reply',
    });
  }

  private async blockRun(
    run: AiRun,
    code: string,
    reason: string,
    priority: 'normal' | 'high' | 'urgent',
    context: Partial<PreflightContext>,
    providerFailure = false,
  ) {
    const status: AiRun['status'] = providerFailure ? 'failed' : 'blocked';
    const changes = {
      status,
      errorCode: code.slice(0, 80),
      sanitizedError: sanitizeOperationalText(reason).slice(0, 1_000),
      lockedAt: null,
      lockedBy: null,
    };
    if (providerFailure) {
      // Check ownership and state in the write itself. A lookup followed
      // by save() can overwrite a reclaimed or already completed run.
      const result = await this.runs.update(
        { id: run.id, status: 'processing', lockedBy: this.workerId },
        changes,
      );
      if (result.affected !== 1) {
        this.logger.warn(
          JSON.stringify({
            event: 'PROCESS_RUN_FAILURE_SKIPPED',
            runId: run.id,
            workerId: this.workerId,
            reason: 'run_ownership_or_status_changed',
          }),
        );
        return;
      }
      Object.assign(run, changes);
    } else {
      Object.assign(run, changes);
      await this.runs.save(run);
    }
    if (
      context.settings &&
      context.state &&
      context.lead &&
      context.triggeringMessage
    ) {
      await this.escalate(
        context as EscalationContext,
        code,
        reason,
        priority,
      );
    }
    if (providerFailure) {
      await this.operations.createTask({
        tenantId: run.tenantId,
        category: 'ai_provider_failure',
        title: 'AI response needs human follow-up',
        description: changes.sanitizedError,
        priority: priority === 'urgent' ? 'critical' : 'high',
        // Dedupe per lead (not per ai_run) for the same alert-storm reason.
        relatedEntityType: 'lead',
        relatedEntityId: run.leadId,
        evidenceNote: `Blocked ai_run ${run.id}`,
        dedupeOpen: true,
        throttleHours: 24,
      });
    }
    await this.audit.recordSystem(run.leadId, 'ai_run_blocked', {
      runId: run.id,
      status: run.status,
      code,
      reason: run.sanitizedError,
    });
  }

  private async escalate(
    context: EscalationContext,
    code: string,
    reason: string,
    priority: 'normal' | 'high' | 'urgent',
  ) {
    context.state.ownershipStatus = 'waiting_for_human';
    context.state.escalationReason = reason.slice(0, 1_000);
    context.state.aiPausedReason = code;
    context.state.lastInboundMessageIdProcessed =
      context.triggeringMessage.id;
    await this.states.save(context.state);
    context.lead.recommendedNextAction =
      'Review the latest message and respond personally.';
    await this.leads.save(context.lead);
    await this.clientOperations.createHandoff(
      context.lead,
      context.triggeringMessage.body,
      {
        priority,
        reason,
        recommendedAction:
          context.lead.recommendedNextAction,
      },
    );
  }

  private async notifyInboundForHuman(lead: Lead, messageId: string) {
    await this.notifications.createForTenant({
      tenantId: lead.tenantId,
      assignedUserId: lead.assignedToUserId,
      eventType: 'lead.replied',
      category: 'leads',
      severity: 'info',
      title: `${lead.fullName} replied`,
      message: 'The conversation is human-controlled. Open the inbox to respond.',
      deduplicationKey: `human-controlled-reply:${messageId}`,
      actionUrl: `/app/inbox?leadId=${lead.id}`,
      entityType: 'lead',
      entityId: lead.id,
    });
  }
}

function safeResumeMaxAgeMinutes(): number {
  const configured = Number(process.env.AUTOMATION_RESUME_MAX_AGE_MINUTES || 15);
  return Number.isFinite(configured) && configured > 0 ? configured : 15;
}

/**
 * Describe the SHAPE of a tool's raw arguments (top-level keys and value
 * types) for log diagnostics. Values are never included, so lead PII cannot
 * leak into application logs.
 */
function describeToolArgShape(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : '';
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    return 'unparseable';
  }
  const shape = (value: unknown): string => {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .slice(0, 12)
        .map(([key, nested]) => `${key}:${shape(nested)}`);
      return `object{${entries.join(',')}}`;
    }
    return typeof value;
  };
  return shape(parsed);
}

function replySubject(subject?: string | null) {
  const value = String(subject || '').trim().slice(0, 490);
  if (!value) return 'Follow-up';
  return /^re:/i.test(value) ? value : `Re: ${value}`;
}
