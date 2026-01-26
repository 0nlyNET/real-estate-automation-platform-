import { TenantSettings } from '../settings/tenant-settings.entity';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Sequence } from './sequence.entity';
import { SequenceEnrollment } from './sequence-enrollment.entity';
import { SequenceStep } from './sequence-step.entity';

import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';

import { Message } from '../messaging/message.entity';
import { Tenant } from '../tenants/tenant.entity';

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
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(TenantSettings)
    private readonly tenantSettingsRepository: Repository<TenantSettings>,
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

  // --- API helpers for the Automations UI (minimal, DB-backed) ---
  async listSequences(tenantId: string) {
    const rows = await this.sequenceRepository.find({
      where: { tenantId } as any,
      relations: ['steps'],
      order: { createdAt: 'DESC' } as any,
    });

    return rows.map((s: any) => ({
      id: s.id,
      name: s.name || 'Untitled automation',
      description: s.description || null,
      active: Boolean(s.active),
      leadType: s.leadType || null,
      temperature: s.temperature || null,
      stepsCount: Array.isArray(s.steps) ? s.steps.length : 0,
      createdAt: s.createdAt || null,
    }));
  }

  async toggleSequence(tenantId: string, id: string) {
    const seq = await this.sequenceRepository.findOne({ where: { id, tenantId } as any });
    if (!seq) return { ok: false, message: 'Not found' };
    (seq as any).active = !Boolean((seq as any).active);
    await this.sequenceRepository.save(seq);
    return { ok: true, active: (seq as any).active };
  }

  /**
   * FIXED: save a single Sequence entity so return has saved.id (not Sequence[])
   */
  async createSequence(tenantId: string, payload: any) {
    const entity = this.sequenceRepository.create({
      tenantId,
      name: String(payload?.name || '').trim() || 'New automation',
      description: payload?.description ? String(payload.description).trim() : null,
      leadType: payload?.leadType ? String(payload.leadType).trim() : null,
      temperature: payload?.temperature ? String(payload.temperature).trim() : null,
      active: payload?.active === false ? false : true,
      steps: Array.isArray(payload?.steps) ? payload.steps : [],
    } as any);

    const saved = await this.sequenceRepository.save(entity);
    return { ok: true, id: (saved as any).id };
  }

  async getSequence(tenantId: string, id: string) {
    const seq = await this.sequenceRepository.findOne({
      where: { id, tenantId } as any,
      relations: ['steps'],
      order: { steps: { offsetMinutes: 'ASC' } } as any,
    });
    if (!seq) return null;
    const s: any = seq as any;
    return {
      id: s.id,
      name: s.name || 'Untitled automation',
      description: s.description || null,
      active: Boolean(s.active),
      leadType: s.leadType || null,
      temperature: s.temperature || null,
      steps: (Array.isArray(s.steps) ? s.steps : []).map((st: any) => ({
        id: st.id,
        channel: st.channel,
        template: st.template,
        offsetMinutes: st.offsetMinutes,
      })),
    };
  }

  async updateSequence(tenantId: string, id: string, payload: any) {
    const seq = await this.sequenceRepository.findOne({ where: { id, tenantId } as any });
    if (!seq) return { ok: false, message: 'Not found' };
    const s: any = seq as any;

    if (payload?.name !== undefined) s.name = String(payload.name).trim() || s.name;
    if (payload?.description !== undefined) s.description = payload.description ? String(payload.description).trim() : null;
    if (payload?.leadType !== undefined) s.leadType = payload.leadType ? String(payload.leadType).trim() : null;
    if (payload?.temperature !== undefined) s.temperature = payload.temperature ? String(payload.temperature).trim() : null;
    if (payload?.active !== undefined) s.active = !!payload.active;

    await this.sequenceRepository.save(seq);
    return { ok: true };
  }

  async addStep(tenantId: string, sequenceId: string, payload: any) {
    const seq = await this.sequenceRepository.findOne({ where: { id: sequenceId, tenantId } as any });
    if (!seq) return { ok: false, message: 'Sequence not found' };

    const step = this.stepRepository.create({
      sequence: { id: sequenceId } as any,
      channel: String(payload?.channel || 'sms'),
      template: String(payload?.template || '').trim() || 'Hi {{firstName}}, just checking in.',
      offsetMinutes: Number.isFinite(Number(payload?.offsetMinutes)) ? Number(payload.offsetMinutes) : 0,
    } as any);

    const saved = await this.stepRepository.save(step);
    return { ok: true, id: (saved as any).id };
  }

  async updateStep(tenantId: string, sequenceId: string, stepId: string, payload: any) {
    const step = await this.stepRepository.findOne({
      where: { id: stepId, sequence: { id: sequenceId, tenantId } as any } as any,
      relations: ['sequence'],
    });
    if (!step) return { ok: false, message: 'Step not found' };
    const st: any = step as any;
    if (payload?.channel !== undefined) st.channel = String(payload.channel || 'sms');
    if (payload?.template !== undefined) st.template = String(payload.template || '').trim();
    if (payload?.offsetMinutes !== undefined && Number.isFinite(Number(payload.offsetMinutes))) {
      st.offsetMinutes = Number(payload.offsetMinutes);
    }
    await this.stepRepository.save(step);
    return { ok: true };
  }

  async deleteStep(tenantId: string, sequenceId: string, stepId: string) {
    const step = await this.stepRepository.findOne({
      where: { id: stepId, sequence: { id: sequenceId, tenantId } as any } as any,
      relations: ['sequence'],
    });
    if (!step) return { ok: false, message: 'Step not found' };
    await this.stepRepository.remove(step);
    return { ok: true };
  }

  async listEnrollmentsForLead(tenantId: string, leadId: string) {
    const lead = await this.leadRepository.findOne({ where: { id: leadId, tenantId } as any });
    if (!lead) return [];
    const enrollments = await this.enrollmentRepository.find({
      where: { lead: { id: leadId } } as any,
      relations: ['sequence'],
      order: { createdAt: 'DESC' } as any,
    });
    return enrollments.map((e: any) => ({
      id: e.id,
      status: e.status,
      currentStepIndex: e.currentStepIndex,
      nextRunAt: e.nextRunAt || null,
      stoppedReason: e.stoppedReason || null,
      sequence: e.sequence ? { id: e.sequence.id, name: e.sequence.name } : null,
    }));
  }

  async pauseEnrollment(tenantId: string, leadId: string, enrollmentId: string) {
    const lead = await this.leadRepository.findOne({ where: { id: leadId, tenantId } as any });
    if (!lead) return { ok: false, message: 'Lead not found' };
    const e = await this.enrollmentRepository.findOne({ where: { id: enrollmentId, lead: { id: leadId } } as any });
    if (!e) return { ok: false, message: 'Enrollment not found' };
    (e as any).status = 'paused';
    (e as any).nextRunAt = undefined;
    await this.enrollmentRepository.save(e);
    return { ok: true };
  }

  async resumeEnrollment(tenantId: string, leadId: string, enrollmentId: string) {
    const lead = await this.leadRepository.findOne({ where: { id: leadId, tenantId } as any });
    if (!lead) return { ok: false, message: 'Lead not found' };
    const e = await this.enrollmentRepository.findOne({
      where: { id: enrollmentId, lead: { id: leadId } } as any,
      relations: ['sequence'],
    });
    if (!e) return { ok: false, message: 'Enrollment not found' };
    (e as any).status = 'active';
    // Resume ASAP (runner will pick it up)
    (e as any).nextRunAt = new Date(Date.now() + 5_000);
    await this.enrollmentRepository.save(e);
    return { ok: true };
  }

  async stopEnrollment(tenantId: string, leadId: string, enrollmentId: string, reason: string = 'manual') {
    const lead = await this.leadRepository.findOne({ where: { id: leadId, tenantId } as any });
    if (!lead) return { ok: false, message: 'Lead not found' };
    const e = await this.enrollmentRepository.findOne({ where: { id: enrollmentId, lead: { id: leadId } } as any });
    if (!e) return { ok: false, message: 'Enrollment not found' };
    (e as any).status = 'stopped';
    (e as any).stoppedReason = reason;
    (e as any).nextRunAt = undefined;
    await this.enrollmentRepository.save(e);
    return { ok: true };
  }

  async stopForLead(leadId: string, reason: 'reply' | 'manual' | 'other' = 'other') {
    try {
      const enrollments = await this.enrollmentRepository.find({
        where: { lead: { id: leadId }, status: 'active' } as any,
      });

      for (const enrollment of enrollments) {
        enrollment.status = 'stopped';
        (enrollment as any).stoppedReason = reason;
        (enrollment as any).nextRunAt = undefined;
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
      (hydrated as any).stoppedReason = 'other';
      (hydrated as any).nextRunAt = undefined;
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
      (hydrated as any).stoppedReason = 'other';
      (hydrated as any).nextRunAt = undefined;
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

    const stepIndex = (hydrated as any).currentStepIndex ?? 0;

    if (stepIndex >= steps.length) {
      hydrated.status = 'completed';
      (hydrated as any).nextRunAt = undefined;
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

    const body = renderTemplate((step as any).template, {
      leadName: (lead as any).fullName ?? '',
      bookingLink,
    });

    // Quiet hours
    const now = new Date();
    const tenantSettings = tenantId
      ? await this.tenantSettingsRepository.findOne({ where: { tenantId } as any })
      : undefined;

    const tz = (tenantSettings as any)?.timeZone || (tenant as any)?.timezone;
    const qStart = (tenantSettings as any)?.quietHoursStart || (tenant as any)?.quietHoursStart;
    const qEnd = (tenantSettings as any)?.quietHoursEnd || (tenant as any)?.quietHoursEnd;

    const scheduledAt =
      tz &&
      qStart &&
      qEnd &&
      isWithinQuietHours({ now, timeZone: tz, quietStart: qStart, quietEnd: qEnd })
        ? nextAllowedSendTime({ now, timeZone: tz, quietStart: qStart, quietEnd: qEnd })
        : undefined;

    const globalDisabled = process.env.GLOBAL_AUTOMATIONS_DISABLED === 'true';
    const tenantSettings2 = tenantId
      ? await this.tenantSettingsRepository.findOne({ where: { tenantId } as any })
      : undefined;
    const tenantDisabled = tenantSettings2 ? (tenantSettings2 as any).automationsEnabled === false : false;

    if (globalDisabled || tenantDisabled) {
      this.logger.warn(
        `Automations disabled, stopping enrollment (enrollmentId=${(hydrated as any).id} tenantId=${tenantId} globalDisabled=${globalDisabled} tenantDisabled=${tenantDisabled})`,
      );
      hydrated.status = 'stopped';
      (hydrated as any).stoppedReason = 'manual';
      (hydrated as any).nextRunAt = undefined;
      await this.enrollmentRepository.save(hydrated);
      return;
    }

    // Create outbound message row (delivery handled by MessagingService)
    const msg = this.messageRepository.create({
      lead,
      channel: (step as any).channel,
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
      channel: (step as any).channel,
      messageId: (msg as any).id,
      scheduledAt: scheduledAt?.toISOString(),
    });

    // Advance enrollment
    (hydrated as any).currentStepIndex = stepIndex + 1;

    const enrolledAt =
      (hydrated as any).createdAt ||
      (hydrated as any).created_at ||
      new Date();

    const nextRunAt = this.computeNextRunAt({
      enrolledAt,
      sequence,
      stepIndex: (hydrated as any).currentStepIndex,
    });

    if ((hydrated as any).currentStepIndex >= steps.length) {
      hydrated.status = 'completed';
      (hydrated as any).nextRunAt = undefined;
    } else {
      (hydrated as any).nextRunAt = nextRunAt ?? undefined;
    }

    await this.enrollmentRepository.save(hydrated);
  }

  private computeNextRunAt(opts: { enrolledAt: Date; sequence: Sequence; stepIndex: number }): Date | undefined {
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
