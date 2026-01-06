import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Sequence } from './sequence.entity';
import { SequenceEnrollment } from './sequence-enrollment.entity';
import { SequenceStep } from './sequence-step.entity';

import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';

import { Message } from '../messaging/message.entity';
import { Tenants } from '../tenants/tenant.entity';

import { isWithinQuietHours, nextAllowedSendTime } from '../../common/time';

@Injectable()
export class SequencesService implements OnModuleInit {
  private readonly logger = new Logger(SequencesService.name);
  private interval: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(Sequence)
    private readonly sequenceRepository: Repository<Sequence>,
    @InjectRepository(SequenceEnrollment)
    private readonly enrollmentRepository: Repository<SequenceEnrollment>,
    @InjectRepository(SequenceStep)
    private readonly stepRepository: Repository<SequenceStep>,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(LeadEvent)
    private readonly leadEventRepository: Repository<LeadEvent>,
    @InjectRepository(Tenants)
    private readonly tenantRepository: Repository<Tenants>,
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
  ) {}

  onModuleInit(): void {
    // DB-backed scheduler for MVP. No Redis required.
    // Runs every 10s and creates outbound Message rows when steps become due.
    this.interval = setInterval(() => {
      this.processDueEnrollments().catch((e) =>
        this.logger.error(`processDueEnrollments failed: ${e?.message ?? e}`),
      );
    }, 10_000);
  }

  async startForLead(lead: Lead) {
    try {
      const leadId = (lead as any).id;
      const tenantId = (lead as any).tenantId || (lead as any).tenant?.id;

      if (!leadId) {
        this.logger.warn(`startForLead called without leadId`);
        return;
      }
      if (!tenantId) {
        this.logger.warn(`startForLead called without tenantId (leadId=${leadId})`);
        return;
      }

      // Prevent duplicate active enrollments
      const existing = await this.enrollmentRepository.findOne({
        where: { lead: { id: leadId }, status: 'active' } as any,
      });
      if (existing) {
        this.logger.log(`Enrollment already active for lead ${leadId}, skipping`);
        return;
      }

      const sequence = await this.sequenceRepository.findOne({
        where: {
          tenantId,
          leadType: (lead as any).leadType,
          temperature: (lead as any).temperature,
        } as any,
        relations: ['steps'],
        order: { steps: { offsetMinutes: 'ASC' } } as any,
      });

      if (!sequence) {
        this.logger.warn(
          `No sequence found for tenant ${tenantId} (leadType=${(lead as any).leadType} temp=${(lead as any).temperature})`,
        );
        return;
      }

      const nextRunAt = this.computeNextRunAt({
        enrolledAt: new Date(),
        sequence,
        stepIndex: 0,
      });

      // IMPORTANT: SequenceEnrollment entity uses relations, not sequenceId/leadId
      const enrollment = this.enrollmentRepository.create({
        sequence: { id: (sequence as any).id } as any,
        lead: { id: leadId } as any,
        status: 'active',
        currentStepIndex: 0,
        nextRunAt: nextRunAt ?? undefined,
      } as any);

      const saved = await this.enrollmentRepository.save(enrollment);

      this.logger.log(
        `Sequence enrollment created (enrollmentId=${(saved as any).id}) sequenceId=${(sequence as any).id} leadId=${leadId} nextRunAt=${nextRunAt?.toISOString() ?? 'n/a'}`,
      );
    } catch (err: any) {
      this.logger.error(
        `startForLead failed (leadId=${(lead as any)?.id ?? 'unknown'}): ${err?.message ?? err}`,
        err?.stack,
      );
      // Never throw: intake must not 500 because sequences failed.
    }
  }

  async stopForLead(leadId: string, reason: 'reply' | 'manual' | 'other' = 'other') {
    try {
      const enrollments = await this.enrollmentRepository.find({
        where: { lead: { id: leadId }, status: 'active' } as any,
      });

      for (const enrollment of enrollments) {
        enrollment.status = 'stopped';
        enrollment.stoppedReason = reason;
        enrollment.nextRunAt = undefined;
        await this.enrollmentRepository.save(enrollment);
      }
    } catch (err: any) {
      this.logger.error(
        `stopForLead failed (leadId=${leadId}): ${err?.message ?? err}`,
        err?.stack,
      );
    }
  }

  // --------------------------
  // Runner
  // --------------------------

  private async processDueEnrollments() {
    const now = new Date();

    // DB columns are snake_case: next_run_at, current_step_index
    const due = await this.enrollmentRepository
      .createQueryBuilder('e')
      .where('e.status = :st', { st: 'active' })
      .andWhere('e.next_run_at IS NOT NULL')
      .andWhere('e.next_run_at <= :now', { now })
      .orderBy('e.next_run_at', 'ASC')
      .take(25)
      .getMany();

    for (const e of due) {
      try {
        await this.runOneEnrollment(e);
      } catch (err: any) {
        this.logger.error(
          `runOneEnrollment failed (enrollmentId=${(e as any)?.id ?? 'unknown'}): ${err?.message ?? err}`,
          err?.stack,
        );
      }
    }
  }

  private async runOneEnrollment(enrollment: SequenceEnrollment) {
    // Load relations so we can access ids reliably
    const hydrated = await this.enrollmentRepository.findOne({
      where: { id: (enrollment as any).id } as any,
      relations: ['sequence', 'lead'],
    });

    if (!hydrated) return;

    const sequenceId = (hydrated as any).sequence?.id;
    const leadId = (hydrated as any).lead?.id;

    if (!sequenceId || !leadId) {
      hydrated.status = 'stopped';
      hydrated.stoppedReason = 'other';
      hydrated.nextRunAt = undefined;
      await this.enrollmentRepository.save(hydrated);
      return;
    }

    const sequence = await this.sequenceRepository.findOne({
      where: { id: sequenceId } as any,
      relations: ['steps'],
      order: { steps: { offsetMinutes: 'ASC' } } as any,
    });

    if (!sequence) {
      hydrated.status = 'stopped';
      hydrated.stoppedReason = 'other';
      hydrated.nextRunAt = undefined;
      await this.enrollmentRepository.save(hydrated);
      return;
    }

    const lead = await this.leadRepository.findOne({
      where: { id: leadId } as any,
      relations: ['tenant'],
    });

    if (!lead) return;

    const steps = (sequence.steps ?? [])
      .slice()
      .sort((a: any, b: any) => (a.offsetMinutes ?? 0) - (b.offsetMinutes ?? 0));

    const stepIndex = hydrated.currentStepIndex ?? 0;

    if (stepIndex >= steps.length) {
      hydrated.status = 'completed';
      hydrated.nextRunAt = undefined;
      await this.enrollmentRepository.save(hydrated);
      return;
    }

    const step = steps[stepIndex];

    const tenantId = (lead as any).tenantId || (lead as any).tenant?.id;
    const tenant =
      (lead as any).tenant ||
      (tenantId
        ? await this.tenantRepository.findOne({ where: { id: tenantId } as any })
        : null);

    const bookingLink = (tenant as any)?.bookingLink ?? '';

    const body = renderTemplate(step.template, {
      leadName: (lead as any).fullName ?? '',
      bookingLink,
    });

    // Quiet hours
    const now = new Date();
    const tz = (tenant as any)?.timezone;
    const qStart = (tenant as any)?.quietHoursStart;
    const qEnd = (tenant as any)?.quietHoursEnd;

    const scheduledAt =
      tz &&
      qStart &&
      qEnd &&
      isWithinQuietHours({ now, timeZone: tz, quietStart: qStart, quietEnd: qEnd })
        ? nextAllowedSendTime({ now, timeZone: tz, quietStart: qStart, quietEnd: qEnd })
        : undefined;

    // Create outbound message row (delivery handled by MessagingService)
    const msg = this.messageRepository.create({
      lead,
      channel: step.channel,
      direction: 'outbound',
      body,
      status: scheduledAt ? 'scheduled' : 'pending',
      scheduledAt,
    } as any);

    await this.messageRepository.save(msg as any);

    await this.logLeadEvent(lead, 'sequence_step_queued', {
      enrollmentId: (hydrated as any).id,
      sequenceId: (sequence as any).id,
      stepIndex,
      channel: step.channel,
      messageId: (msg as any).id,
      scheduledAt: scheduledAt?.toISOString(),
    });

    // Advance enrollment
    hydrated.currentStepIndex = stepIndex + 1;

    const enrolledAt =
      (hydrated as any).createdAt ||
      (hydrated as any).created_at ||
      new Date();

    const nextRunAt = this.computeNextRunAt({
      enrolledAt,
      sequence,
      stepIndex: hydrated.currentStepIndex,
    });

    if (hydrated.currentStepIndex >= steps.length) {
      hydrated.status = 'completed';
      hydrated.nextRunAt = undefined;
    } else {
      hydrated.nextRunAt = nextRunAt ?? undefined;
    }

    await this.enrollmentRepository.save(hydrated);
  }

  private computeNextRunAt(opts: {
    enrolledAt: Date;
    sequence: Sequence;
    stepIndex: number;
  }): Date | undefined {
    const steps = (opts.sequence.steps ?? [])
      .slice()
      .sort((a: any, b: any) => (a.offsetMinutes ?? 0) - (b.offsetMinutes ?? 0));

    const step = steps[opts.stepIndex];
    if (!step) return undefined;

    const minutes = (step as any).offsetMinutes ?? 0;
    return new Date(opts.enrolledAt.getTime() + minutes * 60_000);
  }

  private async logLeadEvent(lead: Lead, eventType: string, metadata?: Record<string, any>) {
    try {
      const ev = this.leadEventRepository.create({
        leadId: (lead as any).id,
        eventType,
        metadata,
      } as any);
      await this.leadEventRepository.save(ev);
    } catch (err: any) {
      this.logger.error(
        `logLeadEvent failed (leadId=${(lead as any)?.id ?? 'unknown'} type=${eventType}): ${err?.message ?? err}`,
      );
    }
  }
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return (template || '')
    .replace(/\{\{\s*leadName\s*\}\}/gi, vars.leadName ?? '')
    .replace(/\{\{\s*bookingLink\s*\}\}/gi, vars.bookingLink ?? '');
}