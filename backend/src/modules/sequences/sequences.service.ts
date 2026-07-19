import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Sequence } from './sequence.entity';
import { SequenceEnrollment } from './sequence-enrollment.entity';
import { SequenceStep } from './sequence-step.entity';
import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Message } from '../messaging/message.entity';
import { Tenant } from '../tenants/tenant.entity';
import { formatHHMM, isWithinQuietHours, nextAllowedSendTime } from '../../common/time';
import { ComplianceService } from '../compliance/compliance.service';
import { hasAtLeastRole, UserRole } from '../../common/rbac';
import { EntitlementService } from '../entitlements/entitlement.service';
import { OperationsService } from '../operations/operations.service';
import { operationalEvent } from '../../common/operational-log';

const CLAIM_LIMIT = 25;
const LEASE_SECONDS = 120;

@Injectable()
export class SequencesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SequencesService.name);
  private readonly workerId = `sequence-${process.env.HOSTNAME || process.pid}`;
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataSource: DataSource,
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
    private readonly complianceService: ComplianceService,
    private readonly entitlements: EntitlementService,
    private readonly operations: OperationsService,
  ) {}

  onModuleInit(): void {
    this.interval = setInterval(() => {
      this.processDueEnrollments().catch((error) =>
        this.logger.error(
          operationalEvent('sequence_worker_failed', {
            workerId: this.workerId,
            error: error?.message ?? error,
          }),
        ),
      );
    }, 10_000);
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  private async requireLeadAccess(
    tenantId: string,
    leadId: string,
    ctx?: { userId?: string; role?: UserRole },
  ) {
    const lead = await this.leadRepository.findOne({ where: { id: leadId, tenantId } });
    if (!lead) throw new ForbiddenException('Lead not found');
    const canSeeAll = ctx?.role ? hasAtLeastRole(ctx.role, 'admin') : false;
    if (!canSeeAll && lead.assignedToUserId !== ctx?.userId) {
      throw new ForbiddenException('Lead is not assigned to this user');
    }
    return lead;
  }

  async startForLead(lead: Lead) {
    const tenantId = lead.tenantId || lead.tenant?.id;
    if (!lead.id || !tenantId) return;
    try {
      await this.entitlements.assertAllowed(tenantId, 'enroll_lead');
      const existing = await this.enrollmentRepository.findOne({
        where: { leadId: lead.id, status: 'active' },
      });
      if (existing) return;

      const sequence = await this.sequenceRepository.findOne({
        where: {
          tenantId,
          active: true,
          leadType: lead.leadType,
          temperature: lead.temperature,
        } as any,
        relations: ['steps'],
        order: { steps: { offsetMinutes: 'ASC' } } as any,
      });
      if (!sequence) return;

      const activeSteps = this.sortedSteps(sequence);
      if (!activeSteps.length || activeSteps.some((step) => step.approvalStatus !== 'approved')) {
        await this.flagInvalidSequence(tenantId, sequence.id, 'Sequence has no approved active steps');
        return;
      }
      for (const channel of new Set(activeSteps.map((step) => step.channel))) {
        const decision = await this.complianceService.communicationEligibility(
          tenantId,
          lead,
          channel,
        );
        if (!decision.allowed) {
          await this.logLeadEvent(lead, 'automation_blocked', {
            channel,
            code: decision.code,
            reason: decision.reason,
          });
          return;
        }
      }

      const nextRunAt = this.computeNextRunAt(new Date(), sequence, 0);
      await this.enrollmentRepository.save(
        this.enrollmentRepository.create({
          sequence: { id: sequence.id } as Sequence,
          sequenceId: sequence.id,
          lead: { id: lead.id } as Lead,
          leadId: lead.id,
          tenantId,
          status: 'active',
          currentStepIndex: 0,
          nextRunAt,
        }),
      );
    } catch (error: any) {
      this.logger.warn(`Lead ${lead.id} was not enrolled: ${error?.message ?? error}`);
      await this.logLeadEvent(lead, 'automation_blocked', {
        reason: error?.response?.reasons || error?.message || 'Not entitled',
      });
    }
  }

  async listSequences(tenantId: string) {
    const rows = await this.sequenceRepository.find({
      where: { tenantId },
      relations: ['steps'],
      order: { createdAt: 'DESC' },
    });
    return rows.map((sequence) => ({
      id: sequence.id,
      name: sequence.name || 'Untitled automation',
      description: sequence.description || null,
      active: sequence.active,
      leadType: sequence.leadType || null,
      temperature: sequence.temperature || null,
      stepsCount: sequence.steps?.length || 0,
      approvedStepsCount:
        sequence.steps?.filter((step) => step.approvalStatus === 'approved').length || 0,
      createdAt: sequence.createdAt,
    }));
  }

  async toggleSequence(tenantId: string, id: string) {
    const sequence = await this.sequenceRepository.findOne({
      where: { id, tenantId },
      relations: ['steps'],
    });
    if (!sequence) return { ok: false, message: 'Not found' };
    if (!sequence.active) await this.assertSequenceCanActivate(tenantId, sequence);
    sequence.active = !sequence.active;
    await this.sequenceRepository.save(sequence);
    return { ok: true, active: sequence.active };
  }

  async createSequence(tenantId: string, payload: any) {
    const sequence = this.sequenceRepository.create({
      tenantId,
      name: String(payload?.name || '').trim() || 'New automation',
      description: payload?.description ? String(payload.description).trim() : null,
      leadType: payload?.leadType ? String(payload.leadType).trim() : null,
      temperature: payload?.temperature ? String(payload.temperature).trim() : null,
      active: false,
    } as Partial<Sequence>) as Sequence;
    const saved = await this.sequenceRepository.save(sequence);
    return {
      ok: true,
      id: saved.id,
      active: false,
      notice: 'Automation remains inactive until every template is approved.',
    };
  }

  async getSequence(tenantId: string, id: string) {
    const sequence = await this.sequenceRepository.findOne({
      where: { id, tenantId },
      relations: ['steps'],
      order: { steps: { offsetMinutes: 'ASC' } } as any,
    });
    if (!sequence) return null;
    return {
      id: sequence.id,
      name: sequence.name || 'Untitled automation',
      description: sequence.description || null,
      active: sequence.active,
      leadType: sequence.leadType || null,
      temperature: sequence.temperature || null,
      steps: this.sortedSteps(sequence, false).map((step) => ({
        id: step.id,
        channel: step.channel,
        template: step.template,
        offsetMinutes: step.offsetMinutes,
        approvalStatus: step.approvalStatus,
        approvedByUserId: step.approvedByUserId || null,
        approvedAt: step.approvedAt || null,
        templateVersion: step.templateVersion,
        identityLabel: step.identityLabel || null,
        active: step.active,
      })),
    };
  }

  async updateSequence(tenantId: string, id: string, payload: any) {
    const sequence = await this.sequenceRepository.findOne({
      where: { id, tenantId },
      relations: ['steps'],
    });
    if (!sequence) return { ok: false, message: 'Not found' };
    if (payload?.name !== undefined)
      sequence.name = String(payload.name).trim() || sequence.name;
    if (payload?.description !== undefined)
      sequence.description = payload.description ? String(payload.description).trim() : null;
    if (payload?.leadType !== undefined)
      sequence.leadType = payload.leadType ? String(payload.leadType).trim() : null as any;
    if (payload?.temperature !== undefined)
      sequence.temperature = payload.temperature ? String(payload.temperature).trim() : null as any;
    if (payload?.active === true && !sequence.active)
      await this.assertSequenceCanActivate(tenantId, sequence);
    if (payload?.active !== undefined) sequence.active = Boolean(payload.active);
    await this.sequenceRepository.save(sequence);
    return { ok: true, active: sequence.active };
  }

  async addStep(tenantId: string, sequenceId: string, payload: any) {
    const sequence = await this.sequenceRepository.findOne({ where: { id: sequenceId, tenantId } });
    if (!sequence) return { ok: false, message: 'Sequence not found' };
    sequence.active = false;
    await this.sequenceRepository.save(sequence);
    const step = await this.stepRepository.save(
      this.stepRepository.create({
        sequence: { id: sequenceId } as Sequence,
        channel: String(payload?.channel || 'sms') as 'sms' | 'email',
        template: String(payload?.template || '').trim(),
        offsetMinutes: Number(payload?.offsetMinutes) || 0,
        identityLabel: String(payload?.identityLabel || '').trim() || null,
        approvalStatus: 'draft',
        templateVersion: 1,
        active: true,
      }),
    );
    return { ok: true, id: step.id, approvalStatus: step.approvalStatus };
  }

  async updateStep(tenantId: string, sequenceId: string, stepId: string, payload: any) {
    const step = await this.findTenantStep(tenantId, sequenceId, stepId);
    if (!step) return { ok: false, message: 'Step not found' };
    const contentChanged =
      (payload?.channel !== undefined && payload.channel !== step.channel) ||
      (payload?.template !== undefined && String(payload.template).trim() !== step.template) ||
      (payload?.identityLabel !== undefined &&
        String(payload.identityLabel || '').trim() !== (step.identityLabel || ''));
    if (payload?.channel !== undefined) step.channel = payload.channel;
    if (payload?.template !== undefined) step.template = String(payload.template).trim();
    if (payload?.identityLabel !== undefined)
      step.identityLabel = String(payload.identityLabel || '').trim() || null;
    if (payload?.offsetMinutes !== undefined) step.offsetMinutes = Number(payload.offsetMinutes);
    if (payload?.active !== undefined) step.active = Boolean(payload.active);
    if (contentChanged) {
      step.approvalStatus = 'draft';
      step.approvedAt = null;
      step.approvedByUserId = null;
      step.templateVersion += 1;
      step.sequence.active = false;
      await this.sequenceRepository.save(step.sequence);
    }
    await this.stepRepository.save(step);
    return { ok: true, approvalStatus: step.approvalStatus, templateVersion: step.templateVersion };
  }

  async approveStep(
    tenantId: string,
    sequenceId: string,
    stepId: string,
    userId: string,
    identityLabel?: string,
  ) {
    const step = await this.findTenantStep(tenantId, sequenceId, stepId);
    if (!step) return { ok: false, message: 'Step not found' };
    if (identityLabel !== undefined)
      step.identityLabel = String(identityLabel || '').trim() || null;
    this.validateTemplate(step);
    step.approvalStatus = 'approved';
    step.approvedByUserId = userId;
    step.approvedAt = new Date();
    await this.stepRepository.save(step);
    return { ok: true, approvalStatus: 'approved', approvedAt: step.approvedAt };
  }

  async deleteStep(tenantId: string, sequenceId: string, stepId: string) {
    const step = await this.findTenantStep(tenantId, sequenceId, stepId);
    if (!step) return { ok: false, message: 'Step not found' };
    step.sequence.active = false;
    await this.sequenceRepository.save(step.sequence);
    await this.stepRepository.remove(step);
    return { ok: true };
  }

  private findTenantStep(tenantId: string, sequenceId: string, stepId: string) {
    return this.stepRepository.findOne({
      where: { id: stepId, sequence: { id: sequenceId, tenantId } as Sequence },
      relations: ['sequence'],
    });
  }

  private validateTemplate(step: SequenceStep) {
    const identity = String(step.identityLabel || '').trim();
    const body = String(step.template || '').trim();
    if (!identity) throw new BadRequestException('Template identity label is required');
    if (!body.toLowerCase().includes(identity.toLowerCase())) {
      throw new BadRequestException('Template body must identify the sender using the identity label');
    }
    if (step.channel === 'sms' && !/\b(reply\s+)?stop\b/i.test(body)) {
      throw new BadRequestException('SMS template must include clear STOP opt-out language');
    }
    if (step.channel === 'email' && !/\{\{\s*unsubscribeUrl\s*\}\}/i.test(body)) {
      throw new BadRequestException('Email template must include {{unsubscribeUrl}}');
    }
  }

  private async assertSequenceCanActivate(tenantId: string, sequence: Sequence) {
    await this.entitlements.assertAllowed(tenantId, 'start_automation');
    const steps = sequence.steps || (await this.stepRepository.find({
      where: { sequence: { id: sequence.id } as Sequence },
    }));
    const active = steps.filter((step) => step.active !== false);
    if (!active.length) throw new BadRequestException('Automation needs at least one active step');
    for (const step of active) {
      if (step.approvalStatus !== 'approved') {
        throw new BadRequestException('Every active template must be approved before activation');
      }
      this.validateTemplate(step);
    }
  }

  async listEnrollmentsForLead(
    tenantId: string,
    leadId: string,
    ctx?: { userId?: string; role?: UserRole },
  ) {
    await this.requireLeadAccess(tenantId, leadId, ctx);
    const rows = await this.enrollmentRepository.find({
      where: { tenantId, leadId },
      relations: ['sequence'],
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      currentStepIndex: row.currentStepIndex,
      nextRunAt: row.nextRunAt || null,
      stoppedReason: row.stoppedReason || null,
      sequence: row.sequence ? { id: row.sequence.id, name: row.sequence.name } : null,
    }));
  }

  async pauseEnrollment(tenantId: string, leadId: string, enrollmentId: string, ctx?: { userId?: string; role?: UserRole }) {
    await this.requireLeadAccess(tenantId, leadId, ctx);
    const enrollment = await this.enrollmentRepository.findOne({ where: { id: enrollmentId, tenantId, leadId } });
    if (!enrollment) return { ok: false, message: 'Enrollment not found' };
    enrollment.status = 'paused';
    enrollment.nextRunAt = undefined;
    enrollment.lockedAt = null;
    enrollment.lockedBy = null;
    await this.enrollmentRepository.save(enrollment);
    return { ok: true };
  }

  async resumeEnrollment(tenantId: string, leadId: string, enrollmentId: string, ctx?: { userId?: string; role?: UserRole }) {
    await this.requireLeadAccess(tenantId, leadId, ctx);
    await this.entitlements.assertAllowed(tenantId, 'run_sequence_step');
    const enrollment = await this.enrollmentRepository.findOne({ where: { id: enrollmentId, tenantId, leadId } });
    if (!enrollment) return { ok: false, message: 'Enrollment not found' };
    enrollment.status = 'active';
    enrollment.nextRunAt = new Date(Date.now() + 5_000);
    await this.enrollmentRepository.save(enrollment);
    return { ok: true };
  }

  async stopEnrollment(tenantId: string, leadId: string, enrollmentId: string, reason = 'manual', ctx?: { userId?: string; role?: UserRole }) {
    await this.requireLeadAccess(tenantId, leadId, ctx);
    const enrollment = await this.enrollmentRepository.findOne({ where: { id: enrollmentId, tenantId, leadId } });
    if (!enrollment) return { ok: false, message: 'Enrollment not found' };
    enrollment.status = 'stopped';
    enrollment.stoppedReason = reason as SequenceEnrollment['stoppedReason'];
    enrollment.nextRunAt = undefined;
    enrollment.lockedAt = null;
    enrollment.lockedBy = null;
    await this.enrollmentRepository.save(enrollment);
    return { ok: true };
  }

  async stopForLead(leadId: string, reason: 'reply' | 'manual' | 'other' | 'opt_out' = 'other') {
    await this.enrollmentRepository.update(
      { leadId, status: In(['active', 'paused']) },
      {
        status: 'stopped',
        stoppedReason: reason,
        nextRunAt: null as any,
        lockedAt: null,
        lockedBy: null,
      },
    );
  }

  async processDueEnrollments(limit = CLAIM_LIMIT) {
    const ids = await this.claimDueEnrollments(Math.min(Math.max(limit, 1), 100));
    for (const id of ids) {
      try {
        await this.runOneEnrollment(id);
      } catch (error: any) {
        this.logger.error(
          operationalEvent('sequence_enrollment_failed', {
            enrollmentId: id,
            workerId: this.workerId,
            error: error?.message ?? error,
          }),
        );
        await this.releaseEnrollment(id, new Date(Date.now() + 5 * 60_000));
      }
    }
    return { claimed: ids.length };
  }

  private claimDueEnrollments(limit: number): Promise<string[]> {
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{ id: string }> = await manager.query(
        `WITH candidates AS (
           SELECT id
           FROM sequence_enrollments
           WHERE status = 'active'
             AND next_run_at IS NOT NULL
             AND next_run_at <= now()
             AND (locked_at IS NULL OR locked_at < now() - ($1 * interval '1 second'))
           ORDER BY next_run_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE sequence_enrollments AS enrollment
         SET locked_at = now(), locked_by = $3
         FROM candidates
         WHERE enrollment.id = candidates.id
         RETURNING enrollment.id`,
        [LEASE_SECONDS, limit, this.workerId],
      );
      return rows.map((row) => row.id);
    });
  }

  private async runOneEnrollment(id: string) {
    const enrollment = await this.enrollmentRepository.findOne({
      where: { id, lockedBy: this.workerId, status: 'active' },
      relations: ['sequence', 'lead'],
    });
    if (!enrollment) return;
    const sequence = await this.sequenceRepository.findOne({
      where: { id: enrollment.sequenceId, tenantId: enrollment.tenantId },
      relations: ['steps'],
      order: { steps: { offsetMinutes: 'ASC' } } as any,
    });
    const lead = await this.leadRepository.findOne({
      where: { id: enrollment.leadId, tenantId: enrollment.tenantId },
      relations: ['tenant'],
    });
    if (!sequence || !lead || !sequence.active) {
      await this.stopEnrollmentInternal(enrollment, 'other');
      return;
    }

    const entitlement = await this.entitlements.evaluate(enrollment.tenantId, 'run_sequence_step');
    if (!entitlement.allowed) {
      await this.logLeadEvent(lead, 'sequence_held', { reasons: entitlement.reasons });
      await this.releaseEnrollment(id, new Date(Date.now() + 5 * 60_000));
      return;
    }
    const steps = this.sortedSteps(sequence);
    const stepIndex = enrollment.currentStepIndex || 0;
    if (stepIndex >= steps.length) {
      enrollment.status = 'completed';
      enrollment.nextRunAt = undefined;
      enrollment.lockedAt = null;
      enrollment.lockedBy = null;
      await this.enrollmentRepository.save(enrollment);
      return;
    }
    const step = steps[stepIndex];
    if (step.approvalStatus !== 'approved') {
      await this.createSkippedMessage(lead, step, enrollment, 'UNAPPROVED_TEMPLATE', 'Template is not approved');
      enrollment.status = 'paused';
      enrollment.nextRunAt = undefined;
      enrollment.lockedAt = null;
      enrollment.lockedBy = null;
      await this.enrollmentRepository.save(enrollment);
      await this.flagInvalidSequence(enrollment.tenantId, sequence.id, 'An active sequence reached an unapproved template');
      return;
    }
    try {
      this.validateTemplate(step);
    } catch (error: any) {
      await this.createSkippedMessage(lead, step, enrollment, 'INVALID_TEMPLATE', error.message);
      enrollment.status = 'paused';
      enrollment.nextRunAt = undefined;
      enrollment.lockedAt = null;
      enrollment.lockedBy = null;
      await this.enrollmentRepository.save(enrollment);
      return;
    }
    const consent = await this.complianceService.communicationEligibility(
      enrollment.tenantId,
      lead,
      step.channel,
    );
    if (!consent.allowed) {
      await this.createSkippedMessage(
        lead,
        step,
        enrollment,
        consent.code || 'MISSING_CONSENT',
        consent.reason || 'Consent check failed',
      );
      await this.advanceEnrollment(enrollment, sequence, stepIndex);
      return;
    }

    const settings = await this.tenantSettingsRepository.findOne({
      where: { tenantId: enrollment.tenantId },
    });
    const tenant = lead.tenant || (await this.tenantRepository.findOne({ where: { id: enrollment.tenantId } }));
    const body = renderTemplate(step.template, {
      leadName: lead.fullName || '',
      firstName: (lead.fullName || '').split(/\s+/)[0] || '',
      bookingLink: settings?.bookingLink || tenant?.bookingLink || '',
    });
    const scheduledAt = await this.scheduledForQuietHours(enrollment.tenantId, settings, tenant);
    const idempotencyKey = `sequence:${enrollment.id}:${stepIndex}:${step.channel}:v${step.templateVersion}`;
    try {
      await this.messageRepository.save(
        this.messageRepository.create({
          lead,
          leadId: lead.id,
          channel: step.channel,
          direction: 'outbound',
          body,
          status: 'queued',
          scheduledAt,
          nextAttemptAt: scheduledAt || new Date(),
          idempotencyKey,
        }),
      );
    } catch (error: any) {
      if (String(error?.code) !== '23505') throw error;
    }
    await this.logLeadEvent(lead, 'sequence_step_queued', {
      enrollmentId: enrollment.id,
      sequenceId: sequence.id,
      stepIndex,
      channel: step.channel,
      idempotencyKey,
      scheduledAt: scheduledAt?.toISOString(),
    });
    await this.advanceEnrollment(enrollment, sequence, stepIndex);
  }

  private async createSkippedMessage(
    lead: Lead,
    step: SequenceStep,
    enrollment: SequenceEnrollment,
    code: string,
    reason: string,
  ) {
    const key = `sequence:${enrollment.id}:${enrollment.currentStepIndex}:${step.channel}:v${step.templateVersion}`;
    try {
      await this.messageRepository.save(
        this.messageRepository.create({
          lead,
          leadId: lead.id,
          channel: step.channel,
          direction: 'outbound',
          body: renderTemplate(step.template, {
            leadName: lead.fullName || '',
            firstName: (lead.fullName || '').split(/\s+/)[0] || '',
            bookingLink: '',
          }),
          status: 'skipped',
          errorCode: code,
          sanitizedErrorMessage: reason,
          lastError: reason,
          idempotencyKey: key,
        }),
      );
    } catch (error: any) {
      if (String(error?.code) !== '23505') throw error;
    }
    await this.logLeadEvent(lead, 'sequence_step_skipped', { code, reason, channel: step.channel });
  }

  private async advanceEnrollment(enrollment: SequenceEnrollment, sequence: Sequence, stepIndex: number) {
    enrollment.currentStepIndex = stepIndex + 1;
    const steps = this.sortedSteps(sequence);
    if (enrollment.currentStepIndex >= steps.length) {
      enrollment.status = 'completed';
      enrollment.nextRunAt = undefined;
    } else {
      enrollment.nextRunAt = this.computeNextRunAt(
        enrollment.createdAt || new Date(),
        sequence,
        enrollment.currentStepIndex,
      );
    }
    enrollment.lockedAt = null;
    enrollment.lockedBy = null;
    await this.enrollmentRepository.save(enrollment);
  }

  private async scheduledForQuietHours(
    tenantId: string,
    settings: TenantSettings | null,
    tenant: Tenant | null,
  ) {
    const quietHours = await this.complianceService.findQuietHours(tenantId);
    const enabled = quietHours?.enabled ?? true;
    const timeZone = quietHours?.timezone || settings?.timeZone || tenant?.timezone;
    const start = quietHours ? formatHHMM(quietHours.startMinute) : settings?.quietHoursStart;
    const end = quietHours ? formatHHMM(quietHours.endMinute) : settings?.quietHoursEnd;
    const now = new Date();
    return enabled && timeZone && start && end &&
      isWithinQuietHours({ now, timeZone, quietStart: start, quietEnd: end })
      ? nextAllowedSendTime({ now, timeZone, quietStart: start, quietEnd: end })
      : undefined;
  }

  private releaseEnrollment(id: string, nextRunAt: Date) {
    return this.enrollmentRepository.update(
      { id, lockedBy: this.workerId },
      { lockedAt: null, lockedBy: null, nextRunAt },
    );
  }

  private async stopEnrollmentInternal(enrollment: SequenceEnrollment, reason: SequenceEnrollment['stoppedReason']) {
    enrollment.status = 'stopped';
    enrollment.stoppedReason = reason;
    enrollment.nextRunAt = undefined;
    enrollment.lockedAt = null;
    enrollment.lockedBy = null;
    await this.enrollmentRepository.save(enrollment);
  }

  private sortedSteps(sequence: Sequence, activeOnly = true) {
    return (sequence.steps || [])
      .filter((step) => !activeOnly || step.active !== false)
      .slice()
      .sort((a, b) => a.offsetMinutes - b.offsetMinutes);
  }

  private computeNextRunAt(enrolledAt: Date, sequence: Sequence, stepIndex: number) {
    const step = this.sortedSteps(sequence)[stepIndex];
    return step ? new Date(enrolledAt.getTime() + step.offsetMinutes * 60_000) : undefined;
  }

  private async flagInvalidSequence(tenantId: string, sequenceId: string, description: string) {
    await this.operations.createTask({
      tenantId,
      category: 'automation_exception',
      title: 'Automation requires operator review',
      description,
      priority: 'high',
      relatedEntityType: 'sequence',
      relatedEntityId: sequenceId,
      dedupeOpen: true,
    });
  }

  private async logLeadEvent(lead: Lead, eventType: string, metadata?: Record<string, any>) {
    try {
      await this.leadEventRepository.save(
        this.leadEventRepository.create({ leadId: lead.id, lead, eventType, metadata } as any),
      );
    } catch (error: any) {
      this.logger.error(`Could not record ${eventType} for lead ${lead.id}: ${error?.message ?? error}`);
    }
  }
}

function renderTemplate(template: string, vars: Record<string, string>) {
  return String(template || '')
    .replace(/\{\{\s*leadName\s*\}\}/gi, vars.leadName || '')
    .replace(/\{\{\s*firstName\s*\}\}/gi, vars.firstName || '')
    .replace(/\{\{\s*bookingLink\s*\}\}/gi, vars.bookingLink || '');
}
