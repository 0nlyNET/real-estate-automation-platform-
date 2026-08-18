import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, In, Not, Repository } from 'typeorm';
import { hasAtLeastRole, UserRole } from '../../common/rbac';
import { CalendarService } from '../calendar/calendar.service';
import { parseTenantDateTime } from '../calendar/calendar-time';
import { AuditService } from '../audit/audit.service';
import { CrmEventsService } from '../crm-events/crm-events.service';
import { DurableJob } from '../durable-jobs/durable-job.entity';
import { DurableJobsService } from '../durable-jobs/durable-jobs.service';
import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { LeadStageEvent } from '../leads/lead-stage-event.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { OperationsService } from '../operations/operations.service';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Appointment } from './appointment.entity';
import { CreateAppointmentDto, UpdateAppointmentDto } from './client-operations.dto';

export type AppointmentAccessContext = { userId?: string; role?: UserRole };

const MAX_APPOINTMENT_DURATION_MS = 8 * 60 * 60_000;
const MAX_APPOINTMENT_HORIZON_MS = 2 * 365 * 24 * 60 * 60_000;

@Injectable()
export class AppointmentBookingService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    @InjectRepository(Lead)
    private readonly leads: Repository<Lead>,
    @InjectRepository(LeadEvent)
    private readonly events: Repository<LeadEvent>,
    @InjectRepository(LeadStageEvent)
    private readonly stageEvents: Repository<LeadStageEvent>,
    @InjectRepository(TenantSettings)
    private readonly settings: Repository<TenantSettings>,
    private readonly calendar: CalendarService,
    private readonly notifications: NotificationsService,
    private readonly crmEvents: CrmEventsService,
    private readonly durableJobs: DurableJobsService,
    private readonly operations: OperationsService,
    private readonly audit: AuditService,
    @Optional() private readonly onboarding?: OnboardingService,
  ) {}

  onModuleInit() {
    this.durableJobs.register('appointment.post_commit', async (job) => {
      const appointmentId = String(job.payload.appointmentId || '');
      if (!appointmentId) throw new Error('Appointment post-commit job is missing appointmentId');
      try {
        await this.runPostCommit(appointmentId);
      } catch (error) {
        if (job.attemptCount >= job.maxAttempts) {
          await this.operations.createTask({
            tenantId: job.tenantId,
            category: 'appointment_workflow',
            title: 'Appointment post-booking actions need attention',
            description:
              'The Google event and internal appointment exist, but agent notification, CRM publication, or UAT evidence could not be completed after retries.',
            priority: 'high',
            relatedEntityType: 'appointment',
            relatedEntityId: appointmentId,
            dedupeOpen: true,
          });
        }
        throw error;
      }
    });
    this.durableJobs.register('appointment.reconcile_create', async (job) => {
      try {
        await this.create(
          String(job.tenantId || ''),
          {
            leadId: String(job.payload.leadId || ''),
            startsAt: String(job.payload.startsAt || ''),
            endsAt: String(job.payload.endsAt || '') || undefined,
            notes: String(job.payload.notes || '') || undefined,
            idempotencyKey: String(job.payload.idempotencyKey || ''),
          },
          undefined,
          String(job.payload.source || 'manual') as Appointment['source'],
          String(job.payload.calendarId || '') || undefined,
        );
      } catch (error) {
        if (job.attemptCount >= job.maxAttempts) {
          await this.operations.createTask({
            tenantId: String(job.tenantId || ''),
            category: 'appointment_workflow',
            title: 'An uncertain Google Calendar booking could not be reconciled',
            description:
              'No internal appointment was confirmed. Review the deterministic Google event and contact the lead before attempting another booking.',
            priority: 'critical',
            relatedEntityType: 'lead',
            relatedEntityId: String(job.payload.leadId || ''),
            dedupeOpen: true,
          });
        }
        throw error;
      }
    });
    this.durableJobs.register('appointment.reconcile_calendar', async (job) => {
      const appointmentId = String(job.payload.appointmentId || '');
      if (!appointmentId) throw new Error('Calendar reconciliation job is missing appointmentId');
      try {
        return await this.reconcile(appointmentId);
      } catch (error: any) {
        const syncErrorCode = String(
          error?.response?.code || error?.code || 'CALENDAR_RECONCILIATION_FAILED',
        ).slice(0, 100);
        await this.appointments.update(
          { id: appointmentId, tenantId: String(job.tenantId || '') },
          { syncStatus: 'needs_attention', syncErrorCode },
        );
        await this.operations.createTask({
          tenantId: String(job.tenantId || ''),
          category: 'appointment_workflow',
          title: 'Google Calendar and an appointment need reconciliation',
          description:
            'RealtyTechAI could not verify that the external event and internal appointment still match. Restore calendar access and review the appointment before relying on it.',
          priority: 'high',
          relatedEntityType: 'appointment',
          relatedEntityId: appointmentId,
          dedupeOpen: true,
        });
        throw error;
      }
    });
  }

  async create(
    tenantId: string,
    dto: CreateAppointmentDto,
    ctx?: AppointmentAccessContext,
    source: Appointment['source'] = 'manual',
    boundCalendarId?: string,
  ) {
    const lead = await this.requireLeadAccess(tenantId, dto.leadId, ctx);
    const timeZone = await this.tenantTimeZone(tenantId);
    const startsAt = parseTenantDateTime(dto.startsAt, timeZone);
    const endsAt = dto.endsAt
      ? parseTenantDateTime(dto.endsAt, timeZone)
      : new Date(startsAt.getTime() + 30 * 60_000);
    this.validateWindow(startsAt, endsAt);
    const suppliedKey = String(dto.idempotencyKey || randomUUID()).trim().slice(0, 120);
    const idempotencyKey = `${source}:${suppliedKey}`;

    return this.calendar.withTenantBookingLock(tenantId, async () => {
      const existing = await this.appointments.findOne({
        where: { tenantId, idempotencyKey },
        relations: ['lead'],
      });
      if (existing) {
        if (existing.leadId !== lead.id) {
          throw new ConflictException('That appointment request key is already in use.');
        }
        if (
          existing.startsAt.getTime() !== startsAt.getTime() ||
          existing.endsAt.getTime() !== endsAt.getTime()
        ) {
          throw new ConflictException({
            code: 'APPOINTMENT_IDEMPOTENCY_CONFLICT',
            message:
              'That appointment request was already completed for a different time. Start a new request.',
          });
        }
        await this.ensureJobs(existing);
        return existing;
      }
      const calendarId =
        boundCalendarId || (await this.calendar.readyCalendarId(tenantId));

      let external;
      try {
        external = await this.calendar.createBookingEvent({
          tenantId,
          calendarId,
          leadId: lead.id,
          start: startsAt,
          end: endsAt,
          summary: `Appointment with ${lead.fullName}`.slice(0, 180),
          description: 'Scheduled through RealtyTechAI. Open the lead in RealtyTechAI for approved conversation context.',
          attendeeEmail: lead.email || null,
          idempotencyKey,
        });
      } catch (error: any) {
        const code = String(error?.response?.code || error?.code || '');
        if (
          ['GOOGLE_CALENDAR_TIMEOUT', 'GOOGLE_CALENDAR_TEMPORARY_FAILURE', 'GOOGLE_EVENT_RESULT_UNCERTAIN'].includes(code)
        ) {
          await this.scheduleCreateReconciliation({
            tenantId,
            leadId: lead.id,
            startsAt: dto.startsAt,
            endsAt: dto.endsAt,
            notes: dto.notes,
            suppliedKey,
            idempotencyKey,
            source,
            calendarId,
          });
          throw new ServiceUnavailableException({
            code: 'APPOINTMENT_RECONCILIATION_PENDING',
            message:
              'Google Calendar did not confirm the result. RealtyTechAI is reconciling it; do not create a duplicate.',
          });
        }
        throw error;
      }

      try {
        return await this.createInternal({
          tenantId,
          leadId: lead.id,
          assignedUserId: lead.assignedToUserId || ctx?.userId || null,
          startsAt,
          endsAt,
          source,
          notes: dto.notes?.trim() || null,
          idempotencyKey,
          externalEventId: external.id,
          externalEventEtag: external.etag,
          externalCalendarId: external.calendarId,
          actorUserId: ctx?.userId || null,
        });
      } catch (error: any) {
        if (String(error?.code || '') === '23505') {
          const duplicate = await this.appointments.findOne({
            where: { tenantId, idempotencyKey },
            relations: ['lead'],
          });
          if (duplicate?.leadId === lead.id) {
            await this.ensureJobs(duplicate);
            return duplicate;
          }
        }
        await this.scheduleCreateReconciliation({
          tenantId,
          leadId: lead.id,
          startsAt: dto.startsAt,
          endsAt: dto.endsAt,
          notes: dto.notes,
          suppliedKey,
          idempotencyKey,
          source,
          calendarId,
        });
        throw new ServiceUnavailableException({
          code: 'APPOINTMENT_RECONCILIATION_PENDING',
          message:
            'The Google event was created, but RealtyTechAI is reconciling the internal appointment. Do not create a duplicate.',
        });
      }
    });
  }

  async update(
    id: string,
    tenantId: string | null,
    dto: UpdateAppointmentDto,
    ctx?: AppointmentAccessContext,
  ) {
    const appointment = await this.requireAppointmentAccess(id, tenantId, ctx);
    return this.calendar.withTenantBookingLock(appointment.tenantId, async () => {
      const current = await this.requireAppointmentAccess(id, tenantId, ctx);
      return this.updateInsideLock(current, dto, ctx);
    });
  }

  private async updateInsideLock(
    appointment: Appointment,
    dto: UpdateAppointmentDto,
    ctx?: AppointmentAccessContext,
  ) {
    const timeZone = await this.tenantTimeZone(appointment.tenantId);
    const previousStatus = appointment.status;
    const previousStartsAt = appointment.startsAt;
    const previousDuration = Math.max(
      appointment.endsAt.getTime() - appointment.startsAt.getTime(),
      30 * 60_000,
    );
    const startsAt = dto.startsAt
      ? parseTenantDateTime(dto.startsAt, timeZone)
      : appointment.startsAt;
    const endsAt = dto.endsAt
      ? parseTenantDateTime(dto.endsAt, timeZone)
      : dto.startsAt
        ? new Date(startsAt.getTime() + previousDuration)
        : appointment.endsAt;
    this.validateWindow(startsAt, endsAt, true);
    const wasRescheduled = startsAt.getTime() !== previousStartsAt.getTime();
    const cancelled = dto.status === 'cancelled' && appointment.status !== 'cancelled';

    let externalEventId = appointment.externalEventId || null;
    let externalEventEtag = appointment.externalEventEtag || null;
    let externalCalendarId = appointment.externalCalendarId || null;
    try {
      if (appointment.externalProvider === 'google' && externalEventId) {
        if (cancelled) {
          await this.calendar.cancelBookingEvent({
            tenantId: appointment.tenantId,
            eventId: externalEventId,
            etag: externalEventEtag,
            calendarId: appointment.externalCalendarId,
          });
          externalEventEtag = null;
        } else if (wasRescheduled) {
          const updated = await this.calendar.updateBookingEvent({
            tenantId: appointment.tenantId,
            eventId: externalEventId,
            etag: externalEventEtag,
            calendarId: appointment.externalCalendarId,
            start: startsAt,
            end: endsAt,
            summary: `Appointment with ${appointment.lead.fullName}`.slice(0, 180),
            attendeeEmail: appointment.lead.email || null,
          });
          externalEventEtag = updated.etag;
        }
      } else if (wasRescheduled && !cancelled) {
        const converted = await this.calendar.createBookingEvent({
          tenantId: appointment.tenantId,
          leadId: appointment.leadId,
          start: startsAt,
          end: endsAt,
          summary: `Appointment with ${appointment.lead.fullName}`.slice(0, 180),
          description: 'Scheduled through RealtyTechAI.',
          attendeeEmail: appointment.lead.email || null,
          idempotencyKey: `legacy-reschedule:${appointment.id}`,
        });
        externalEventId = converted.id;
        externalEventEtag = converted.etag;
        externalCalendarId = converted.calendarId;
      }
    } catch (error: any) {
      await this.appointments.update(
        { id: appointment.id, tenantId: appointment.tenantId },
        {
          syncStatus: 'needs_attention',
          syncErrorCode: String(
            error?.response?.code || error?.code || 'CALENDAR_UPDATE_FAILED',
          ).slice(0, 100),
        },
      );
      await this.scheduleReconciliation(appointment);
      throw error;
    }

    try {
      const saved = await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(Appointment);
        const locked = await repository
          .createQueryBuilder('appointment')
          .leftJoinAndSelect('appointment.lead', 'lead')
          .setLock('pessimistic_write')
          .where('appointment.id = :id', { id: appointment.id })
          .getOneOrFail();
        locked.startsAt = startsAt;
        locked.endsAt = endsAt;
        if (dto.status) locked.status = dto.status;
        if (dto.confirmationStatus) locked.confirmationStatus = dto.confirmationStatus;
        if (dto.followUpStatus) locked.followUpStatus = dto.followUpStatus;
        if (dto.notes !== undefined) locked.notes = dto.notes.trim() || null;
        if (wasRescheduled) {
          locked.status = 'scheduled';
          locked.confirmationStatus = 'pending';
          locked.confirmationTaskCreatedAt = new Date();
          locked.reminderStatus = 'scheduled';
          locked.reminderSentAt = null;
        }
        if (['completed', 'cancelled', 'no_show'].includes(locked.status)) {
          locked.followUpStatus =
            dto.followUpStatus || (locked.followUpStatus === 'completed' ? 'completed' : 'due');
          locked.reminderStatus = 'cancelled';
        }
        if (externalEventId) {
          locked.externalProvider = 'google';
          locked.externalCalendarId = externalCalendarId;
          locked.externalEventId = externalEventId;
          locked.externalEventEtag = externalEventEtag;
          locked.syncStatus = 'synced';
          locked.syncErrorCode = null;
          locked.lastSyncedAt = new Date();
          locked.calendarSource = 'Google Calendar';
        } else if (locked.status === 'cancelled') {
          locked.syncStatus = 'not_synced';
          locked.syncErrorCode = null;
        }
        const result = await repository.save(locked);
        await manager.getRepository(LeadEvent).save(
          manager.getRepository(LeadEvent).create({
            lead: locked.lead,
            eventType: 'appointment_updated',
            metadata: { appointmentId: locked.id, status: locked.status },
          }),
        );
        if (['completed', 'cancelled', 'no_show'].includes(result.status)) {
          result.lead.nextFollowUpAt = new Date();
          result.lead.recommendedNextAction =
            result.status === 'completed'
              ? 'Record the appointment outcome and next milestone.'
              : 'Contact the lead and agree on the next step.';
          if (result.status === 'cancelled' && result.lead.stage === 'appointment_set') {
            const otherUpcoming = await repository.count({
              where: {
                id: Not(result.id),
                leadId: result.leadId,
                status: In(['scheduled', 'confirmed']),
              },
            });
            if (!otherUpcoming) {
              const previousStage = result.lead.stage;
              result.lead.stage = 'qualified';
              await manager.getRepository(LeadStageEvent).save(
                manager.getRepository(LeadStageEvent).create({
                  tenantId: result.tenantId,
                  leadId: result.leadId,
                  previousStage,
                  newStage: result.lead.stage,
                  changedByUserId: ctx?.userId || null,
                  changeSource: 'appointment_cancelled',
                }),
              );
            }
          }
          await manager.getRepository(Lead).save(result.lead);
        }
        return result;
      });
      await this.scheduleReconciliation(saved);
      if (saved.status !== previousStatus || wasRescheduled) {
        await this.notifications.createForTenant({
          tenantId: saved.tenantId,
          assignedUserId: saved.assignedUserId,
          eventType: cancelled
            ? 'appointment.cancelled'
            : wasRescheduled
              ? 'appointment.rescheduled'
              : 'appointment.updated',
          category: 'leads',
          severity: cancelled ? 'warning' : 'success',
          title: cancelled
            ? `Appointment with ${saved.lead.fullName} was cancelled`
            : wasRescheduled
              ? `Appointment with ${saved.lead.fullName} was rescheduled`
              : `Appointment with ${saved.lead.fullName} is ${saved.status}`,
          message: cancelled
            ? 'Google Calendar and RealtyTechAI were updated. Agree on the next step.'
            : 'Google Calendar, RealtyTechAI, and Today were updated.',
          deduplicationKey: wasRescheduled
            ? `appointment-rescheduled:${saved.id}:${saved.startsAt.toISOString()}`
            : `appointment-status:${saved.id}:${saved.status}`,
          actionUrl: `/app/appointments?appointmentId=${saved.id}`,
          entityType: 'appointment',
          entityId: saved.id,
        });
      }
      return saved;
    } catch {
      await this.scheduleReconciliation(appointment);
      throw new ServiceUnavailableException({
        code: 'APPOINTMENT_RECONCILIATION_PENDING',
        message:
          'Google Calendar was updated, but RealtyTechAI is reconciling the appointment record. Do not repeat the change.',
      });
    }
  }

  private async createInternal(input: {
    tenantId: string;
    leadId: string;
    assignedUserId: string | null;
    startsAt: Date;
    endsAt: Date;
    source: Appointment['source'];
    notes: string | null;
    idempotencyKey: string;
    externalEventId: string;
    externalEventEtag: string | null;
    externalCalendarId: string;
    actorUserId: string | null;
  }) {
    return this.dataSource.transaction(async (manager) => {
      const appointmentRepository = manager.getRepository(Appointment);
      const leadRepository = manager.getRepository(Lead);
      const lead = await leadRepository
        .createQueryBuilder('lead')
        .setLock('pessimistic_write')
        .where('lead.id = :leadId AND lead.tenantId = :tenantId', {
          leadId: input.leadId,
          tenantId: input.tenantId,
        })
        .getOneOrFail();
      const appointment = await appointmentRepository.save(
        appointmentRepository.create({
          tenantId: input.tenantId,
          leadId: lead.id,
          lead,
          assignedUserId: lead.assignedToUserId || input.assignedUserId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          status: 'scheduled',
          source: input.source,
          calendarSource: 'Google Calendar',
          confirmationStatus: 'pending',
          confirmationTaskCreatedAt: new Date(),
          reminderStatus: 'scheduled',
          reminderSentAt: null,
          followUpStatus: 'not_due',
          notes: input.notes,
          externalEventId: input.externalEventId,
          externalEventEtag: input.externalEventEtag,
          externalProvider: 'google',
          externalCalendarId: input.externalCalendarId,
          idempotencyKey: input.idempotencyKey,
          syncStatus: 'synced',
          lastSyncedAt: new Date(),
          syncErrorCode: null,
          postCommitCompletedAt: null,
        }),
      );
      const previousStage = lead.stage;
      lead.stage = 'appointment_set';
      lead.recommendedNextAction = 'Prepare for the appointment and confirm the time.';
      lead.nextFollowUpAt = input.startsAt;
      await leadRepository.save(lead);
      if (previousStage !== lead.stage) {
        await manager.getRepository(LeadStageEvent).save(
          manager.getRepository(LeadStageEvent).create({
            tenantId: input.tenantId,
            leadId: lead.id,
            previousStage,
            newStage: lead.stage,
            changedByUserId: input.actorUserId,
            changeSource: input.source === 'conversation' ? 'ai_calendar_booking' : 'calendar_booking',
          }),
        );
      }
      await manager.getRepository(LeadEvent).save(
        manager.getRepository(LeadEvent).create({
          lead,
          eventType: 'appointment_created',
          metadata: {
            appointmentId: appointment.id,
            source: input.source,
            externalProvider: 'google',
          },
        }),
      );
      const jobRepository = manager.getRepository(DurableJob);
      await jobRepository.save([
        jobRepository.create({
          taskType: 'appointment.post_commit',
          tenantId: input.tenantId,
          dedupeKey: `appointment-post-commit:${appointment.id}`,
          payload: { appointmentId: appointment.id },
          status: 'scheduled',
          nextRunAt: new Date(),
          attemptCount: 0,
          maxAttempts: 10,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: null,
          completedAt: null,
        }),
        jobRepository.create({
          taskType: 'appointment.reconcile_calendar',
          tenantId: input.tenantId,
          dedupeKey: `appointment-calendar-reconcile:${appointment.id}`,
          payload: { appointmentId: appointment.id },
          status: 'scheduled',
          nextRunAt: new Date(Date.now() + 5 * 60_000),
          attemptCount: 0,
          maxAttempts: 12,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastError: null,
          completedAt: null,
        }),
      ]);
      return appointment;
    });
  }

  private async runPostCommit(appointmentId: string) {
    const appointment = await this.appointments.findOne({
      where: { id: appointmentId },
      relations: ['lead'],
    });
    if (!appointment || appointment.postCommitCompletedAt) return;
    const createdNotifications = await this.notifications.createForTenant({
      tenantId: appointment.tenantId,
      assignedUserId: appointment.assignedUserId,
      eventType: 'appointment.created',
      category: 'leads',
      severity: 'success',
      title: `Appointment scheduled with ${appointment.lead.fullName}`,
      message: 'The time is verified and the event is on the selected Google Calendar.',
      deduplicationKey: `appointment-created:${appointment.id}`,
      actionUrl: `/app/appointments?appointmentId=${appointment.id}`,
      entityType: 'appointment',
      entityId: appointment.id,
    });
    if (!createdNotifications.length) {
      throw new Error('No eligible assigned agent or workspace administrator could be notified');
    }
    const crmPublication = await this.crmEvents.publish(
      appointment.tenantId,
      'appointment.created',
      {
        appointmentId: appointment.id,
        leadId: appointment.leadId,
        assignedToUserId: appointment.assignedUserId || null,
        startsAt: appointment.startsAt.toISOString(),
        status: appointment.status,
        source: appointment.source,
        externalProvider: 'google',
        testRunId: appointment.lead.testRunId || null,
      },
      { idempotencyKey: `appointment.created:${appointment.id}` },
    );
    if (crmPublication.queued < 1) {
      throw new Error(
        'No active appointment.created CRM subscription accepted the appointment event',
      );
    }
    await this.audit.recordSystemEvent({
      tenantId: appointment.tenantId,
      eventType: 'appointment.workflow_completed',
      resourceType: 'appointment',
      resourceId: appointment.id,
      metadata: {
        provider: 'google',
        notificationRecipients: createdNotifications.length,
        crmEventPublished: crmPublication.queued > 0,
      },
    });
    if (appointment.lead.testRunId) {
      await this.onboarding?.recordUatWorkflowEvidence(
        appointment.tenantId,
        appointment.lead.testRunId,
        {
          calendarAvailability: true,
          externalCalendarEvent: true,
          internalAppointment: true,
          agentNotification: true,
        },
      );
    }
    appointment.postCommitCompletedAt = new Date();
    await this.appointments.save(appointment);
  }

  private async reconcile(appointmentId: string) {
    const candidate = await this.appointments.findOne({
      where: { id: appointmentId },
      relations: ['lead'],
    });
    if (
      !candidate ||
      candidate.externalProvider !== 'google' ||
      !candidate.externalEventId ||
      ['completed', 'no_show'].includes(candidate.status)
    ) {
      return;
    }
    return this.calendar.withTenantBookingLock(candidate.tenantId, async () => {
      const appointment = await this.appointments.findOne({
        where: { id: appointmentId, tenantId: candidate.tenantId },
        relations: ['lead'],
      });
      if (
        !appointment ||
        appointment.externalProvider !== 'google' ||
        !appointment.externalEventId ||
        ['completed', 'no_show'].includes(appointment.status)
      ) {
        return;
      }
      const external = await this.calendar.getBookingEvent(
        appointment.tenantId,
        appointment.externalEventId,
        appointment.externalCalendarId,
      );
      if (!external || external.status === 'cancelled') {
        if (appointment.status !== 'cancelled') {
          await this.updateInsideLock(appointment, { status: 'cancelled' });
        }
        return;
      }
      if (!external.startsAt || !external.endsAt) {
        appointment.syncStatus = 'needs_attention';
        appointment.syncErrorCode = 'GOOGLE_EVENT_TIME_MISSING';
        await this.appointments.save(appointment);
        throw new Error('Google Calendar event has no timed start/end');
      }
      const changed =
        external.startsAt.getTime() !== appointment.startsAt.getTime() ||
        external.endsAt.getTime() !== appointment.endsAt.getTime();
      appointment.externalEventEtag = external.etag;
      appointment.lastSyncedAt = new Date();
      appointment.syncStatus = 'synced';
      appointment.syncErrorCode = null;
      if (changed) {
        appointment.startsAt = external.startsAt;
        appointment.endsAt = external.endsAt;
        appointment.confirmationStatus = 'pending';
        appointment.reminderStatus = 'scheduled';
        appointment.reminderSentAt = null;
      }
      await this.appointments.save(appointment);
      if (changed) {
        await this.notifications.createForTenant({
          tenantId: appointment.tenantId,
          assignedUserId: appointment.assignedUserId,
          eventType: 'appointment.reconciled',
          category: 'leads',
          severity: 'warning',
          title: `Calendar change reconciled for ${appointment.lead.fullName}`,
          message:
            'The Google Calendar time changed outside RealtyTechAI. The internal appointment now matches it.',
          deduplicationKey: `appointment-reconciled:${appointment.id}:${appointment.startsAt.toISOString()}`,
          actionUrl: `/app/appointments?appointmentId=${appointment.id}`,
          entityType: 'appointment',
          entityId: appointment.id,
        });
      }
      if (appointment.startsAt > new Date()) {
        return { nextRunAt: new Date(Date.now() + 6 * 60 * 60_000) };
      }
    });
  }

  private async ensureJobs(appointment: Appointment) {
    if (!appointment.postCommitCompletedAt) {
      await this.durableJobs.schedule({
        taskType: 'appointment.post_commit',
        tenantId: appointment.tenantId,
        dedupeKey: `appointment-post-commit:${appointment.id}`,
        payload: { appointmentId: appointment.id },
        maxAttempts: 10,
      });
    }
    await this.scheduleReconciliation(appointment);
  }

  private scheduleCreateReconciliation(input: {
    tenantId: string;
    leadId: string;
    startsAt: string;
    endsAt?: string;
    notes?: string;
    suppliedKey: string;
    idempotencyKey: string;
    source: Appointment['source'];
    calendarId: string;
  }) {
    return this.durableJobs.schedule({
      taskType: 'appointment.reconcile_create',
      tenantId: input.tenantId,
      dedupeKey: `appointment-reconcile-create:${input.tenantId}:${input.idempotencyKey}`,
      payload: {
        leadId: input.leadId,
        startsAt: input.startsAt,
        endsAt: input.endsAt || '',
        notes: input.notes || '',
        idempotencyKey: input.suppliedKey,
        source: input.source,
        calendarId: input.calendarId,
      },
      maxAttempts: 8,
    });
  }

  private scheduleReconciliation(appointment: Appointment) {
    if (appointment.externalProvider !== 'google' || !appointment.externalEventId) {
      return Promise.resolve(null);
    }
    return this.durableJobs.schedule({
      taskType: 'appointment.reconcile_calendar',
      tenantId: appointment.tenantId,
      dedupeKey: `appointment-calendar-reconcile:${appointment.id}`,
      payload: { appointmentId: appointment.id },
      nextRunAt: new Date(Date.now() + 30_000),
      maxAttempts: 12,
    });
  }

  private validateWindow(start: Date, end: Date, allowPast = false) {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new BadRequestException('Appointment end time must be after its start time.');
    }
    if (!allowPast && start <= new Date()) {
      throw new BadRequestException('Choose a future appointment time.');
    }
    if (start.getTime() > Date.now() + MAX_APPOINTMENT_HORIZON_MS) {
      throw new BadRequestException('Choose an appointment within the next two years.');
    }
    if (end.getTime() - start.getTime() > MAX_APPOINTMENT_DURATION_MS) {
      throw new BadRequestException('Appointment duration cannot exceed eight hours.');
    }
  }

  private async tenantTimeZone(tenantId: string) {
    const settings = await this.settings.findOne({ where: { tenantId } });
    return settings?.timeZone || 'America/New_York';
  }

  private async requireLeadAccess(
    tenantId: string,
    leadId: string,
    ctx?: AppointmentAccessContext,
  ) {
    const lead = await this.leads.findOne({ where: { id: leadId, tenantId } });
    if (!lead) throw new NotFoundException('Lead not found');
    if (
      ctx?.role &&
      !hasAtLeastRole(ctx.role, 'admin') &&
      lead.assignedToUserId !== ctx.userId
    ) {
      throw new ForbiddenException('This lead is assigned to another team member.');
    }
    return lead;
  }

  private async requireAppointmentAccess(
    id: string,
    tenantId: string | null,
    ctx?: AppointmentAccessContext,
  ) {
    const query = this.appointments
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.lead', 'lead')
      .where('appointment.id = :id', { id });
    if (tenantId) query.andWhere('appointment.tenantId = :tenantId', { tenantId });
    if (ctx?.role && !hasAtLeastRole(ctx.role, 'admin')) {
      query.andWhere('lead.assignedToUserId = :userId', {
        userId: ctx.userId || '00000000-0000-0000-0000-000000000000',
      });
    }
    const appointment = await query.getOne();
    if (!appointment) throw new NotFoundException('Appointment not found');
    return appointment;
  }
}
