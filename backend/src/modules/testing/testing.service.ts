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

@Injectable()
export class TestingService implements OnModuleInit {
  constructor(
    @InjectRepository(TestRun)
    private readonly runs: Repository<TestRun>,
    @InjectRepository(Sequence)
    private readonly sequences: Repository<Sequence>,
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
  ) {
    const onboarding = await this.onboarding.getOrCreate(tenantId);
    const phone = input.smsRecipient
      ? normalizePhoneE164(input.smsRecipient)
      : null;
    const email = String(input.emailRecipient || '').trim().toLowerCase() || null;
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
    if (existing && existing.expiresAt.getTime() > Date.now()) return existing;
    if (existing) {
      existing.status = 'expired';
      existing.completedAt = new Date();
      existing.failureReason = 'Controlled test run expired before completion';
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
      const lead = await this.leads.intake(
        tenantId,
        {
          fullName: 'RealtyTechAI Controlled Test',
          email: email || undefined,
          phone: phone || undefined,
          source: 'controlled_uat',
          leadType: sequence.leadType || undefined,
          temperature: sequence.temperature || undefined,
          message: `Controlled test run ${run.id}`,
          consent: {
            sms: Boolean(phone),
            email: Boolean(email),
            source: 'controlled_uat',
          },
        } as any,
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
      return run;
    } catch (error: any) {
      run.status = 'failed';
      run.failureReason = String(error?.message || error).slice(0, 2_000);
      run.completedAt = new Date();
      await this.runs.save(run);
      throw error;
    }
  }

  list(tenantId: string) {
    return this.runs.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }
}
