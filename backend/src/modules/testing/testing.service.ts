import { BadRequestException, Injectable, OnModuleInit, Optional } from '@nestjs/common';
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
  constructor(
    @InjectRepository(TestRun)
    private readonly runs: Repository<TestRun>,
    @InjectRepository(Sequence)
    private readonly sequences: Repository<Sequence>,
    @InjectRepository(AiRun)
    private readonly aiRuns: Repository<AiRun>,
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
        return { run: existing, isNew: false };
      }
      existing.status = 'expired';
      existing.completedAt = new Date();
      if (!existing.failureReason) {
        existing.failureReason = 'Controlled test run expired before completion';
      }
      await this.runs.save(existing);
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
    const stuck = aiRunCount === 0;
    console.log(
      `[TestingService] isStuckRun(${run.id}): age=${Math.round(ageMs / 60000)}min, ` +
        `testLeadId=${run.testLeadId}, aiRunCount=${aiRunCount}, stuck=${stuck}`,
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
}
