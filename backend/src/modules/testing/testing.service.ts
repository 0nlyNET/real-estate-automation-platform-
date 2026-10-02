import { BadRequestException, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { normalizePhoneE164 } from '../../common/phone';
import { LeadsService } from '../leads/leads.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { TestRun } from './test-run.entity';
import { DurableJobsService } from '../durable-jobs/durable-jobs.service';
import { Sequence } from '../sequences/sequence.entity';
import { AiRun } from '../ai/ai-run.entity';
import { Message } from '../messaging/message.entity';
import { LeadConsentDto, ConsentEvidenceDto } from '../compliance/consent.dto';
import { IntakeLeadDto } from '../leads/dto/intake-lead.dto';

const CONTROLLED_LEAD_TYPES = ['buyer', 'seller', 'renter', 'investor'] as const;
type ControlledLeadType = (typeof CONTROLLED_LEAD_TYPES)[number];
const CONTROLLED_TEMPERATURES = ['cold', 'warm', 'hot'] as const;
type ControlledTemperature = (typeof CONTROLLED_TEMPERATURES)[number];

/** Type-safe narrowing of the free-form sequence fields; no `as any`. */
function asControlledLeadType(value: string): ControlledLeadType | undefined {
  return (CONTROLLED_LEAD_TYPES as readonly string[]).includes(value)
    ? (value as ControlledLeadType)
    : undefined;
}

function asControlledTemperature(
  value: string,
): ControlledTemperature | undefined {
  return (CONTROLLED_TEMPERATURES as readonly string[]).includes(value)
    ? (value as ControlledTemperature)
    : undefined;
}

@Injectable()
export class TestingService implements OnModuleInit {
  private readonly logger = new Logger(TestingService.name);

  constructor(
    @InjectRepository(TestRun)
    private readonly runs: Repository<TestRun>,
    @InjectRepository(Sequence)
    private readonly sequences: Repository<Sequence>,
    @InjectRepository(AiRun)
    private readonly aiRuns: Repository<AiRun>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    private readonly onboarding: OnboardingService,
    private readonly leads: LeadsService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly jobs?: DurableJobsService,
  ) {}

  onModuleInit() {
    this.jobs?.register('testing.start', async (job) => {
      if (!job.tenantId) throw new Error('Testing job is missing tenantId');
      await this.start(job.tenantId, null, {
        smsRecipient: String(job.payload.smsRecipient || '') || undefined,
        emailRecipient: String(job.payload.emailRecipient || '') || undefined,
      });
    });
  }

  async start(
    tenantId: string,
    operatorId: string | null,
    input: { smsRecipient?: string; emailRecipient?: string },
  ): Promise<{ run: TestRun; isNew: boolean }> {
    const onboarding = await this.onboarding.getOrCreate(tenantId);
    const phone = normalizePhoneE164(String(
      input.smsRecipient ?? onboarding.contacts?.controlledTestPhone ?? '',
    ));
    const email = String(
      input.emailRecipient ?? onboarding.contacts?.controlledTestEmail ?? onboarding.contacts?.accountOwner ?? '',
    ).trim().toLowerCase() || null;
    if (onboarding.smsEnabled && !phone) {
      throw new BadRequestException('A valid controlled SMS recipient is required');
    }
    if (
      onboarding.emailEnabled &&
      (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ) {
      throw new BadRequestException('A valid controlled email recipient is required');
    }
    const existing = await this.runs.findOne({
      where: { tenantId, status: 'running' },
      order: { createdAt: 'DESC' },
    });
    if (existing) {
      // A 'running' test run whose intake-time automation decision is final
      // and which can never complete (no AI run was queued, no outbound was
      // delivered, no active sequence enrollment remains) would otherwise
      // block retries for 24h. Detect it as stuck, expire it, and start fresh.
      // This covers the operator sending the test lead before the AI
      // configuration is approved: intake correctly fail-closes (no AI run),
      // but the run must be retryable once AI is approved.
      if (existing.expiresAt.getTime() > Date.now() && !(await this.isStuckRun(existing))) {
        // Return existing run with isNew=false so the caller can distinguish
        // "test already in progress" from "new test started". This prevents
        // the false-success UX where the frontend reports a new test started
        // when nothing actually happened.
        // Operator observability: log the active run ID so it can be aborted
        // via the PR #116 endpoint without UI.
        this.logger.log(
          JSON.stringify({
            event: 'ACTIVE_TEST_RUN',
            testRunId: existing.id,
            tenantId: existing.tenantId,
            status: existing.status,
            createdAt: existing.createdAt,
            leadId: existing.testLeadId,
          }),
        );
        return { run: existing, isNew: false };
      }
      existing.status = 'expired';
      existing.completedAt = new Date();
      if (!existing.failureReason) {
        existing.failureReason = 'Controlled test run expired before completion';
      }
      await this.runs.save(existing);
      // Cancel any still-claimable outbound messages for the expired run's test lead
      // so a stale rehearsal message can never send after the run is superseded.
      if (existing.testLeadId) {
        try {
          const pending = await this.messages.find({
            where: { leadId: existing.testLeadId },
          });
          for (const msg of pending) {
            const claimable = ['created', 'queued', 'pending', 'scheduled', 'sending'].includes(msg.status);
            const isOutbound = (msg as any).direction === 'outbound';
            if (claimable && isOutbound) {
              msg.status = 'canceled' as any;
              (msg as any).canceledAt = new Date();
              (msg as any).errorCode = 'CONTROLLED_TEST_SUPERSEDED';
              (msg as any).sanitizedErrorMessage = existing.failureReason;
              await this.messages.save(msg);
              console.log(`[TestingService] canceled stale message ${msg.id} for expired run ${existing.id}`);
            }
          }
        } catch (e) {
          console.log(`[TestingService] message cleanup failed for run ${existing.id}: ${e?.message || e}`);
        }
      }
    }
    const sequence = (await this.sequences.find({
      where: { tenantId, active: true },
      relations: ['steps'],
      order: { createdAt: 'ASC' },
    })).find((candidate) => {
      const channels = new Set(
        (candidate.steps || [])
          .filter(
            (step) =>
              step.active !== false && step.approvalStatus === 'approved',
          )
          .map((step) => step.channel),
      );
      return (
        (!onboarding.smsEnabled || channels.has('sms')) &&
        (!onboarding.emailEnabled || channels.has('email'))
      );
    });
    if (!sequence) {
      throw new BadRequestException(
        'An active approved automation covering every enabled channel is required for controlled testing',
      );
    }
    await this.onboarding.beginTesting(tenantId, operatorId || 'system');
    const run = await this.runs.save(
      this.runs.create({
        tenantId,
        startedById: operatorId,
        status: 'running',
        smsRecipient: phone,
        emailRecipient: email,
        testLeadId: null,
        checks: {
          intake: 'pending',
          outbound: 'pending',
          inbound: 'pending',
          ...(onboarding.bookingEnabled
            ? {
                calendarAvailability: 'pending',
                externalCalendarEvent: 'pending',
                internalAppointment: 'pending',
                agentNotification: 'pending',
                crmAppointmentEvent: 'pending',
                humanTakeover: 'pending',
              }
            : {}),
        },
        expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        failureReason: null,
        completedAt: null,
      }),
    );
    try {
      // Build proper LeadConsentDto with nested ConsentEvidenceDto for controlled UAT.
      // This creates explicit, auditable synthetic consent evidence ONLY for the
      // controlled test recipient. Normal/live leads remain fail-closed (no synthetic consent).
      const consentedAt = new Date().toISOString();
      const disclosureText = 'Synthetic controlled UAT recipient explicitly authorized for RealtyTechAI staging testing.';
      const consent: LeadConsentDto = {};
      if (email) {
        const emailEvidence: ConsentEvidenceDto = {
          affirmative: true,
          source: 'controlled_uat',
          consentedAt,
          disclosureText,
          sourceIdentifier: run.id,
          clientAttested: true,
        };
        consent.email = emailEvidence;
      }
      if (phone) {
        const smsEvidence: ConsentEvidenceDto = {
          affirmative: true,
          source: 'controlled_uat',
          consentedAt,
          disclosureText,
          sourceIdentifier: run.id,
          clientAttested: true,
        };
        consent.sms = smsEvidence;
      }
      const intakeDto: Omit<IntakeLeadDto, 'phone'> & { phone?: string } = {
        fullName: 'RealtyTechAI Controlled Test',
        email: email || undefined,
        phone: phone || undefined,
        source: 'controlled_uat',
        leadType: asControlledLeadType(sequence.leadType),
        temperature: asControlledTemperature(sequence.temperature),
        message: `Controlled test run ${run.id}`,
        consent,
      };
      const lead = await this.leads.intake(
        tenantId,
        intakeDto,
        { source: 'controlled_uat', controlledTest: true, testRunId: run.id },
      );
      run.testLeadId = lead.id;
      run.checks = {
        ...run.checks,
        intake: 'passed',
        leadId: lead.id,
        outbound: 'awaiting_provider_callbacks',
        inbound: 'awaiting_controlled_replies',
      };
      await this.runs.save(run);
      await this.notifications.createForTenant({
        tenantId,
        eventType: 'testing.notification',
        category: 'system',
        severity: 'success',
        title: 'Controlled readiness test started',
        message: 'The isolated test lead entered the normal automation pipeline.',
        deduplicationKey: `test-run:${run.id}`,
        entityType: 'test_run',
        entityId: run.id,
      });
      return { run, isNew: true };
    } catch (error: any) {
      run.status = 'failed';
      run.failureReason = String(error?.message || error).slice(0, 2_000);
      run.completedAt = new Date();
      await this.runs.save(run);
      throw error;
    }
  }

  /**
   * True when a 'running' test run can never complete and is safe to replace.
   * The intake-time automation decision is final: if no AI run was queued for
   * the test lead, none ever will be. The run is stuck when, after a grace
   * period for the sequence fallback to fire, there is still no AI run and
   * no delivered outbound for the test lead. A fallback sequence enrollment
   * does not fulfill the test's purpose (the AI conversation loop), so it
   * does not prevent the run from being replaced; the enrollment itself is
   * lead-bound and is unaffected by expiring the run.
   */
  private async isStuckRun(run: TestRun): Promise<boolean> {
    const STUCK_AFTER_MS = 10 * 60_000;
    const ageMs = Date.now() - run.createdAt.getTime();
    if (ageMs < STUCK_AFTER_MS) return false;
    const checks = (run.checks || {}) as Record<string, unknown>;
    if (checks.outbound === 'delivered') return false;
    if (!run.testLeadId) {
      console.log(`[TestingService] isStuckRun(${run.id}): no testLeadId, stuck=true (age=${Math.round(ageMs / 60000)}min)`);
      return true;
    }
    // If the test lead no longer exists, the run can never complete.
    try {
      await this.leads.getLeadById(run.tenantId, run.testLeadId);
    } catch {
      console.log(`[TestingService] isStuckRun(${run.id}): testLead ${run.testLeadId} not found, stuck=true`);
      return true;
    }
    const aiRunCount = await this.aiRuns.count({
      where: { tenantId: run.tenantId, leadId: run.testLeadId },
    });
    // Diagnostic: check if the test lead's outbound message is claimable by the worker.
    // Uses the same predicates as MessagingService.claimMessages (no raw SQL).
    let messageDiag = 'no outbound message found';
    try {
      const msg = await this.messages.findOne({
        where: { leadId: run.testLeadId, direction: 'outbound' as any },
        order: { createdAt: 'DESC' },
      });
      if (msg) {
        const now = Date.now();
        const reasons: string[] = [];
        // Predicate 1: status must be claimable
        const claimableStatuses = ['created', 'queued', 'pending', 'scheduled', 'sending'];
        if (!claimableStatuses.includes(msg.status)) {
          reasons.push(`status=${msg.status} not in claimable set`);
        }
        // Predicate 2: if status is 'sending', provider_submission_started_at must be null
        // (Message entity field name check - using any for safety)
        const msgAny = msg as any;
        if (msg.status === 'sending' && msgAny.providerSubmissionStartedAt) {
          reasons.push('status=sending with provider_submission_started_at set');
        }
        // Predicate 3: scheduled_at must be null or in past
        if (msg.scheduledAt && msg.scheduledAt.getTime() > now) {
          reasons.push(`scheduledAt=${msg.scheduledAt.toISOString()} is in future`);
        }
        // Predicate 4: next_attempt_at must be null or in past
        if (msg.nextAttemptAt && msg.nextAttemptAt.getTime() > now) {
          reasons.push(`nextAttemptAt=${msg.nextAttemptAt.toISOString()} is in future`);
        }
        // Predicate 5: locked_at must be null or older than 120s (MESSAGE_LEASE_SECONDS)
        if (msg.lockedAt && msg.lockedAt.getTime() > now - 120_000) {
          reasons.push(`lockedAt=${msg.lockedAt.toISOString()} is active (within 120s lease)`);
        }
        const claimEligible = reasons.length === 0;
        messageDiag =
          `msgId=${msg.id}, status=${msg.status}, providerStatus=${msg.providerStatus}, ` +
          `scheduledAt=${msg.scheduledAt?.toISOString() || 'null'}, ` +
          `nextAttemptAt=${msg.nextAttemptAt?.toISOString() || 'null'}, ` +
          `lockedAt=${msg.lockedAt?.toISOString() || 'null'}, ` +
          `attemptCount=${msg.attemptCount}, lastError=${msg.lastError || 'null'}, ` +
          `claimEligibleNow=${claimEligible}` +
          (reasons.length > 0 ? `, ineligibilityReasons=[${reasons.join('; ')}]` : '');
      }
    } catch (e) {
      messageDiag = `message lookup failed: ${e?.message || e}`;
    }
    // A controlled test run whose outbound message is scheduled far in the future
    // (e.g. by pre-fix quiet-hours logic) can never complete its E2E verification
    // in a reasonable time. Treat it as stuck so the operator can retry.
    // Post-fix (PR #115), controlled test messages bypass quiet-hours scheduling,
    // so this condition should never occur for new runs.
    let futureScheduled = false;
    let terminallyBlocked = false;
    try {
      const msg = await this.messages.findOne({
        where: { leadId: run.testLeadId, direction: 'outbound' as any },
        order: { createdAt: 'DESC' },
      });
      if (msg?.scheduledAt && msg.scheduledAt.getTime() > Date.now() + 60 * 60_000) {
        futureScheduled = true;
        console.log(`[TestingService] isStuckRun(${run.id}): outbound message ${msg.id} scheduled ${msg.scheduledAt.toISOString()} (>60min future), stuck=true`);
      }
      // A run with ANY outbound message in a terminal non-delivered state
      // (blocked, failed, canceled) can never complete the E2E. Check all
      // messages, not just the latest — a run may have a blocked AI message
      // plus a newer queued template message.
      const terminalStates = ['blocked', 'failed', 'canceled', 'cancelled'];
      const allOutbound = await this.messages.find({
        where: { leadId: run.testLeadId, direction: 'outbound' as any },
      });
      const blockedMsg = allOutbound.find((m) => terminalStates.includes(m.status));
      if (blockedMsg) {
        terminallyBlocked = true;
        console.log(`[TestingService] isStuckRun(${run.id}): outbound message ${blockedMsg.id} status=${blockedMsg.status} (terminal), stuck=true`);
      }
    } catch {
      // Ignore lookup failures here; the diagnostic above already logged them.
    }
    const stuck = aiRunCount === 0 || futureScheduled || terminallyBlocked;
    console.log(
      `[TestingService] isStuckRun(${run.id}): age=${Math.round(ageMs / 60000)}min, ` +
        `testLeadId=${run.testLeadId}, aiRunCount=${aiRunCount}, stuck=${stuck}, ` +
        `message: ${messageDiag}`,
    );
    return stuck;
  }

  list(tenantId: string) {
    return this.runs.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  /**
   * Returns the current active (running) controlled test run for a tenant,
   * with correlated IDs for operator observability. Used to safely abort
   * and retrigger controlled UAT without building UI.
   */
  async getActiveRun(tenantId: string): Promise<{
    testRunId: string | null;
    tenantId: string;
    status: string | null;
    createdAt: Date | null;
    leadId: string | null;
    aiRunId: string | null;
  }> {
    const active = await this.runs.findOne({
      where: { tenantId, status: 'running' },
      order: { createdAt: 'DESC' },
    });
    if (!active) {
      return {
        testRunId: null,
        tenantId,
        status: null,
        createdAt: null,
        leadId: null,
        aiRunId: null,
      };
    }
    // aiRunId: look up via lead's AI runs if lead exists
    let aiRunId: string | null = null;
    if (active.testLeadId) {
      try {
        const aiRun = await this.aiRuns?.findOne({
          where: { leadId: active.testLeadId },
          order: { createdAt: 'DESC' },
        });
        aiRunId = aiRun?.id ?? null;
      } catch {
        // aiRuns repository may not be injected; leave null
      }
    }
    return {
      testRunId: active.id,
      tenantId: active.tenantId,
      status: active.status,
      createdAt: active.createdAt,
      leadId: active.testLeadId,
      aiRunId,
    };
  }

  /**
   * Returns diagnostic details for the active controlled test run, including
   * AI run status and outbound message safety details. Scoped strictly by
   * tenantId. Only returns sanitized failure details — never credentials or
   * raw provider payloads.
   */
  async getTestDiagnostics(tenantId: string): Promise<{
    testRunId: string | null;
    status: string | null;
    leadId: string | null;
    aiRun: {
      id: string | null;
      status: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    } | null;
    messages: Array<{
      id: string;
      channel: string;
      direction: string;
      status: string;
      errorCode: string | null;
      blockedReason: string | null;
      safetyRuleIds: string[];
      sanitizedErrorMessage: string | null;
    }>;
  }> {
    const active = await this.getActiveRun(tenantId);
    if (!active.testRunId) {
      return {
        testRunId: null,
        status: null,
        leadId: null,
        aiRun: null,
        messages: [],
      };
    }

    // AI run details
    let aiRun: { id: string | null; status: string | null; errorCode: string | null; errorMessage: string | null } | null = null;
    if (active.aiRunId) {
      const run = await this.aiRuns.findOne({ where: { id: active.aiRunId, tenantId } });
      if (run) {
        aiRun = {
          id: run.id,
          status: (run as any).status || null,
          errorCode: (run as any).errorCode || null,
          errorMessage: (run as any).errorMessage || null,
        };
      }
    }

    // Outbound messages with safety details
    const messages: Array<{
      id: string;
      channel: string;
      direction: string;
      status: string;
      errorCode: string | null;
      blockedReason: string | null;
      safetyRuleIds: string[];
      sanitizedErrorMessage: string | null;
    }> = [];
    if (active.leadId) {
      // The lead is already tenant-scoped through the active run lookup
      // above; Message carries no tenantId column (tenant comes via lead).
      const msgs = await this.messages.find({
        where: { leadId: active.leadId },
        order: { createdAt: 'DESC' },
        take: 20,
      });
      for (const m of msgs) {
        const msg = m as any;
        // Only include outbound messages (inbound are not relevant to delivery diagnostics)
        if (msg.direction !== 'outbound') continue;
        messages.push({
          id: msg.id,
          channel: msg.channel || 'unknown',
          direction: msg.direction,
          status: msg.status,
          errorCode: msg.errorCode || null,
          blockedReason: msg.blockedReason || null,
          safetyRuleIds: Array.isArray(msg.safetyRuleIds) ? msg.safetyRuleIds : [],
          sanitizedErrorMessage: msg.sanitizedErrorMessage || msg.errorMessage || null,
        });
      }
    }

    return {
      testRunId: active.testRunId,
      status: active.status,
      leadId: active.leadId,
      aiRun,
      messages,
    };
  }

  /**
   * Safely aborts a controlled UAT test run.
   *
   * This is the minimal operator control for terminating a rehearsal that
   * should not continue (e.g. created under pre-fix behavior). It:
   * - operates only on rows in the test_runs table (controlled tests by construction)
   * - scopes strictly by tenantId + testRunId
   * - is idempotent (already-terminal runs return success without changes)
   * - marks the run with the closest valid terminal state ('expired') and records the reason
   * - cancels any still-claimable outbound messages for the test lead so the
   *   worker can never pick them up later (prevents stale rehearsal sends)
   * - preserves all records as historical evidence (no deletes)
   * - never touches production leads/messages (test lead is bound to the run)
   */
  async abortTestRun(
    tenantId: string,
    testRunId: string,
    reason: string,
  ): Promise<{ runId: string; status: string; canceledMessages: string[]; alreadyTerminal: boolean }> {
    const run = await this.runs.findOne({ where: { id: testRunId, tenantId } });
    if (!run) {
      throw new BadRequestException('Test run not found for this tenant');
    }
    if (run.status !== 'running') {
      return { runId: run.id, status: run.status, canceledMessages: [], alreadyTerminal: true };
    }
    const canceledMessages: string[] = [];
    // Cancel any outbound messages for the test lead that the worker could still claim.
    // Setting status='canceled' removes them from claimMessages' claimable set.
    if (run.testLeadId) {
      const pending = await this.messages.find({
        where: { leadId: run.testLeadId },
      });
      for (const msg of pending) {
        const claimable = ['created', 'queued', 'pending', 'scheduled', 'sending'].includes(msg.status);
        const isOutbound = (msg as any).direction === 'outbound';
        if (claimable && isOutbound) {
          msg.status = 'canceled' as any;
          (msg as any).canceledAt = new Date();
          (msg as any).errorCode = 'CONTROLLED_TEST_ABORTED';
          (msg as any).sanitizedErrorMessage = reason;
          await this.messages.save(msg);
          canceledMessages.push(msg.id);
        }
      }
    }
    run.status = 'expired';
    run.completedAt = new Date();
    run.failureReason = reason;
    await this.runs.save(run);
    console.log(
      `[TestingService] abortTestRun(${testRunId}): status=expired, reason=${reason}, canceledMessages=${canceledMessages.length}`,
    );
    return { runId: run.id, status: run.status, canceledMessages, alreadyTerminal: false };
  }
}
