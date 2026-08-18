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
import { BookingProviderRegistry } from '../calendar/booking-provider.registry';
import {
  AppointmentMode,
  BookingProviderAdapter,
  BookingProviderName,
  ProviderAppointment,
} from '../calendar/booking-provider.types';
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
    @Optional() private readonly providers?: BookingProviderRegistry,
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
              'The provider appointment and internal appointment exist, but agent notification, CRM publication, or UAT evidence could not be completed after retries.',
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
            meetingMode: (String(job.payload.meetingMode || '') || undefined) as
              | AppointmentMode
              | undefined,
          },
          undefined,
          String(job.payload.source || 'manual') as Appointment['source'],
          String(job.payload.resourceId || job.payload.calendarId || '') || undefined,
          (String(job.payload.provider || '') || undefined) as
            | BookingProviderName
            | undefined,
        );
      } catch (error) {
        if (job.attemptCount >= job.maxAttempts) {
          await this.operations.createTask({
            tenantId: String(job.tenantId || ''),
            category: 'appointment_workflow',
            title: 'An uncertain provider booking could not be reconciled',
            description:
              'No internal appointment was confirmed. Review the deterministic provider record and contact the lead before attempting another booking.',
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
          title: 'A provider appointment needs reconciliation',
          description:
            'RealtyTechAI could not verify that the provider record and internal appointment still match. Restore provider access and review the appointment before relying on it.',
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
    boundProvider?: BookingProviderName,
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

    if (this.providers) {
      return this.createWithProvider({
        tenantId,
        dto,
        ctx,
        source,
        lead,
        timeZone,
        startsAt,
        endsAt,
        suppliedKey,
        idempotencyKey,
        boundResourceId: boundCalendarId,
        boundProvider,
      });
    }

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

  private async createWithProvider(input: {
    tenantId: string;
    dto: CreateAppointmentDto;
    ctx?: AppointmentAccessContext;
    source: Appointment['source'];
    lead: Lead;
    timeZone: string;
    startsAt: Date;
    endsAt: Date;
    suppliedKey: string;
    idempotencyKey: string;
    boundResourceId?: string;
    boundProvider?: BookingProviderName;
  }) {
    const adapter = input.boundProvider
      ? this.providers!.adapter(input.boundProvider)
      : await this.providers!.active(input.tenantId);
    return this.providers!.withTenantBookingLock(
      adapter.name,
      input.tenantId,
      async () => {
        const existing = await this.appointments.findOne({
          where: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
          relations: ['lead'],
        });
        if (existing) {
          if (existing.leadId !== input.lead.id) {
            throw new ConflictException(
              'That appointment request key is already in use.',
            );
          }
          if (
            existing.startsAt.getTime() !== input.startsAt.getTime() ||
            existing.endsAt.getTime() !== input.endsAt.getTime()
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

        const binding = await adapter.readyBinding(input.tenantId);
        if (
          input.boundProvider &&
          input.boundProvider !== binding.provider
        ) {
          throw new ConflictException({
            code: 'BOOKING_PROVIDER_CHANGED_DURING_RECONCILIATION',
            message:
              'The original booking provider is no longer selected. Review the pending booking before retrying.',
          });
        }
        const resourceId = input.boundResourceId || binding.resourceId;
        const meetingMode = input.dto.meetingMode || 'in_person';
        let external: ProviderAppointment;
        try {
          external = await adapter.createAppointment({
            tenantId: input.tenantId,
            resourceId,
            leadId: input.lead.id,
            start: input.startsAt,
            end: input.endsAt,
            timeZone: input.timeZone,
            summary: `Appointment with ${input.lead.fullName}`.slice(0, 180),
            description:
              'Scheduled through RealtyTechAI. Open the lead in RealtyTechAI for approved conversation context.',
            attendeeName: input.lead.fullName,
            attendeeEmail: input.lead.email || null,
            idempotencyKey: input.idempotencyKey,
            mode: meetingMode,
          });
        } catch (error: any) {
          if (this.isUncertainProviderCreate(error)) {
            await this.scheduleCreateReconciliation({
              tenantId: input.tenantId,
              leadId: input.lead.id,
              startsAt: input.dto.startsAt,
              endsAt: input.dto.endsAt,
              notes: input.dto.notes,
              suppliedKey: input.suppliedKey,
              idempotencyKey: input.idempotencyKey,
              source: input.source,
              calendarId: resourceId,
              provider: adapter.name,
              meetingMode,
            });
            throw new ServiceUnavailableException({
              code: 'APPOINTMENT_RECONCILIATION_PENDING',
              message: `${this.providerLabel(adapter)} did not confirm the result. RealtyTechAI is reconciling it; do not create a duplicate.`,
            });
          }
          throw error;
        }

        try {
          return await this.createInternal({
            tenantId: input.tenantId,
            leadId: input.lead.id,
            assignedUserId:
              input.lead.assignedToUserId || input.ctx?.userId || null,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            source: input.source,
            notes: input.dto.notes?.trim() || null,
            idempotencyKey: input.idempotencyKey,
            externalEventId: external.id,
            externalEventEtag: external.version,
            externalCalendarId: external.resourceId,
            externalProvider: external.storedProvider,
            externalConnectionId: external.connectionId,
            externalInviteeId: external.inviteeId,
            externalJoinUrl: external.joinUrl,
            externalCancelUrl: external.cancelUrl,
            externalRescheduleUrl: external.rescheduleUrl,
            externalProviderUpdatedAt: external.providerUpdatedAt,
            meetingMode,
            actorUserId: input.ctx?.userId || null,
          });
        } catch (error: any) {
          if (String(error?.code || '') === '23505') {
            const duplicate = await this.appointments.findOne({
              where: {
                tenantId: input.tenantId,
                idempotencyKey: input.idempotencyKey,
              },
              relations: ['lead'],
            });
            if (duplicate?.leadId === input.lead.id) {
              await this.ensureJobs(duplicate);
              return duplicate;
            }
          }
          await this.scheduleCreateReconciliation({
            tenantId: input.tenantId,
            leadId: input.lead.id,
            startsAt: input.dto.startsAt,
            endsAt: input.dto.endsAt,
            notes: input.dto.notes,
            suppliedKey: input.suppliedKey,
            idempotencyKey: input.idempotencyKey,
            source: input.source,
            calendarId: resourceId,
            provider: adapter.name,
            meetingMode,
          });
          throw new ServiceUnavailableException({
            code: 'APPOINTMENT_RECONCILIATION_PENDING',
            message: `${this.providerLabel(adapter)} confirmed the appointment, but RealtyTechAI is reconciling the internal record. Do not create a duplicate.`,
          });
        }
      },
    );
  }

  async update(
    id: string,
    tenantId: string | null,
    dto: UpdateAppointmentDto,
    ctx?: AppointmentAccessContext,
  ) {
    const appointment = await this.requireAppointmentAccess(id, tenantId, ctx);
    if (this.providers) {
      const adapter = appointment.externalProvider
        ? this.providers.forStoredProvider(appointment.externalProvider)
        : await this.providers.active(appointment.tenantId);
      return this.providers.withTenantBookingLock(
        adapter.name,
        appointment.tenantId,
        async () => {
          const current = await this.requireAppointmentAccess(id, tenantId, ctx);
          return this.updateWithProvider(current, dto, adapter, ctx);
        },
      );
    }
    return this.calendar.withTenantBookingLock(appointment.tenantId, async () => {
      const current = await this.requireAppointmentAccess(id, tenantId, ctx);
      return this.updateInsideLock(current, dto, ctx);
    });
  }

  private async updateWithProvider(
    appointment: Appointment,
    dto: UpdateAppointmentDto,
    adapter: BookingProviderAdapter,
    ctx?: AppointmentAccessContext,
  ) {
    const timeZone = await this.tenantTimeZone(appointment.tenantId);
    const previousStatus = appointment.status;
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
    const timingChanged =
      startsAt.getTime() !== appointment.startsAt.getTime() ||
      endsAt.getTime() !== appointment.endsAt.getTime();
    const cancelled =
      dto.status === 'cancelled' && appointment.status !== 'cancelled';
    const mode = dto.meetingMode || appointment.meetingMode || 'in_person';
    const modeChanged =
      dto.meetingMode !== undefined &&
      dto.meetingMode !== (appointment.meetingMode || 'in_person');
    if (modeChanged && appointment.externalEventId) {
      throw new ConflictException({
        code: 'APPOINTMENT_MODE_CHANGE_REQUIRES_REBOOK',
        message:
          'Changing an existing appointment between in-person, phone, and virtual can alter provider meeting details. Cancel and create a new verified booking instead.',
      });
    }

    let external: ProviderAppointment | null = null;
    try {
      if (appointment.externalProvider && appointment.externalEventId) {
        if (cancelled) {
          await this.cancelProviderEventWithConflictResolution(
            adapter,
            appointment,
          );
        } else if (timingChanged) {
          external = await this.updateProviderTimeWithConflictResolution(
            adapter,
            appointment,
            startsAt,
            endsAt,
            timeZone,
            mode,
          );
        }
      } else if (timingChanged && !cancelled) {
        const binding = await adapter.readyBinding(appointment.tenantId);
        external = await adapter.createAppointment({
          tenantId: appointment.tenantId,
          resourceId: binding.resourceId,
          leadId: appointment.leadId,
          start: startsAt,
          end: endsAt,
          timeZone,
          summary: `Appointment with ${appointment.lead.fullName}`.slice(0, 180),
          description: 'Scheduled through RealtyTechAI.',
          attendeeName: appointment.lead.fullName,
          attendeeEmail: appointment.lead.email || null,
          idempotencyKey: `legacy-reschedule:${appointment.id}`,
          mode,
        });
      }
    } catch (error: any) {
      const errorCode = this.providerErrorCode(error);
      if (
        [
          'APPOINTMENT_EXTERNAL_CHANGE_RECONCILED',
          'CALENDAR_TIME_UNAVAILABLE',
          'CALENDLY_RESCHEDULE_URL_REQUIRED',
        ].includes(errorCode)
      ) {
        throw error;
      }
      await this.appointments.update(
        { id: appointment.id, tenantId: appointment.tenantId },
        {
          syncStatus: 'needs_attention',
          syncErrorCode: String(errorCode || 'CALENDAR_UPDATE_FAILED').slice(
            0,
            100,
          ),
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
          .where(
            'appointment.id = :id AND appointment.tenantId = :tenantId',
            { id: appointment.id, tenantId: appointment.tenantId },
          )
          .getOneOrFail();
        locked.startsAt = startsAt;
        locked.endsAt = endsAt;
        locked.meetingMode = mode;
        if (dto.status) locked.status = dto.status;
        if (dto.confirmationStatus) {
          locked.confirmationStatus = dto.confirmationStatus;
        }
        if (dto.followUpStatus) locked.followUpStatus = dto.followUpStatus;
        if (dto.notes !== undefined) locked.notes = dto.notes.trim() || null;
        if (timingChanged) {
          locked.status = 'scheduled';
          locked.confirmationStatus = 'pending';
          locked.confirmationTaskCreatedAt = new Date();
          locked.reminderStatus = 'scheduled';
          locked.reminderSentAt = null;
        }
        if (['completed', 'cancelled', 'no_show'].includes(locked.status)) {
          locked.followUpStatus =
            dto.followUpStatus ||
            (locked.followUpStatus === 'completed' ? 'completed' : 'due');
          locked.reminderStatus = 'cancelled';
        }
        if (external) {
          locked.externalProvider = external.storedProvider;
          locked.externalConnectionId = external.connectionId;
          locked.externalCalendarId = external.resourceId;
          locked.externalEventId = external.id;
          locked.externalInviteeId = external.inviteeId;
          locked.externalEventEtag = external.version;
          locked.externalJoinUrl =
            external.joinUrl || locked.externalJoinUrl || null;
          locked.externalCancelUrl =
            external.cancelUrl || locked.externalCancelUrl || null;
          locked.externalRescheduleUrl =
            external.rescheduleUrl || locked.externalRescheduleUrl || null;
          locked.externalProviderUpdatedAt = external.providerUpdatedAt;
          locked.syncStatus = 'synced';
          locked.syncErrorCode = null;
          locked.lastSyncedAt = new Date();
          locked.calendarSource = this.providerLabel(adapter);
        } else if (cancelled && locked.externalEventId) {
          locked.externalEventEtag = null;
          locked.syncStatus = 'synced';
          locked.syncErrorCode = null;
          locked.lastSyncedAt = new Date();
        } else if (!locked.externalEventId && locked.status === 'cancelled') {
          locked.syncStatus = 'not_synced';
          locked.syncErrorCode = null;
        }
        const result = await repository.save(locked);
        await manager.getRepository(LeadEvent).save(
          manager.getRepository(LeadEvent).create({
            lead: locked.lead,
            eventType: 'appointment_updated',
            metadata: {
              appointmentId: locked.id,
              status: locked.status,
              externalProvider: locked.externalProvider,
            },
          }),
        );
        if (['completed', 'cancelled', 'no_show'].includes(result.status)) {
          result.lead.nextFollowUpAt = new Date();
          result.lead.recommendedNextAction =
            result.status === 'completed'
              ? 'Record the appointment outcome and next milestone.'
              : 'Contact the lead and agree on the next step.';
          if (
            result.status === 'cancelled' &&
            result.lead.stage === 'appointment_set'
          ) {
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
      if (saved.status !== previousStatus || timingChanged) {
        const eventType = cancelled
          ? 'appointment.cancelled'
          : timingChanged
            ? 'appointment.rescheduled'
            : 'appointment.updated';
        await this.notifications.createForTenant({
          tenantId: saved.tenantId,
          assignedUserId: saved.assignedUserId,
          eventType,
          category: 'leads',
          severity: cancelled ? 'warning' : 'success',
          title: cancelled
            ? `Appointment with ${saved.lead.fullName} was cancelled`
            : timingChanged
              ? `Appointment with ${saved.lead.fullName} was rescheduled`
              : `Appointment with ${saved.lead.fullName} is ${saved.status}`,
          message: `${this.providerLabel(adapter)} and RealtyTechAI were updated.`,
          deduplicationKey: timingChanged
            ? `appointment-rescheduled:${saved.id}:${saved.startsAt.toISOString()}:${saved.endsAt.toISOString()}`
            : `appointment-status:${saved.id}:${saved.status}`,
          actionUrl: `/app/appointments?appointmentId=${saved.id}`,
          entityType: 'appointment',
          entityId: saved.id,
        });
        await this.publishAppointmentChange(saved, eventType);
      }
      return saved;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      await this.scheduleReconciliation(appointment);
      throw new ServiceUnavailableException({
        code: 'APPOINTMENT_RECONCILIATION_PENDING',
        message: `${this.providerLabel(adapter)} was updated, but RealtyTechAI is reconciling the appointment record. Do not repeat the change.`,
      });
    }
  }

  private async updateInsideLock(
    appointment: Appointment,
    dto: UpdateAppointmentDto,
    ctx?: AppointmentAccessContext,
  ) {
    const timeZone = await this.tenantTimeZone(appointment.tenantId);
    const previousStatus = appointment.status;
    const previousStartsAt = appointment.startsAt;
    const previousEndsAt = appointment.endsAt;
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
    const timingChanged =
      startsAt.getTime() !== previousStartsAt.getTime() ||
      endsAt.getTime() !== previousEndsAt.getTime();
    const cancelled = dto.status === 'cancelled' && appointment.status !== 'cancelled';

    let externalEventId = appointment.externalEventId || null;
    let externalEventEtag = appointment.externalEventEtag || null;
    let externalCalendarId = appointment.externalCalendarId || null;
    try {
      if (appointment.externalProvider === 'google' && externalEventId) {
        if (cancelled) {
          await this.cancelGoogleEventWithConflictResolution(appointment);
          externalEventEtag = null;
        } else if (timingChanged) {
          const updated = await this.updateGoogleTimeWithConflictResolution(
            appointment,
            startsAt,
            endsAt,
          );
          externalEventEtag = updated.etag;
        }
      } else if (timingChanged && !cancelled) {
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
      const errorCode = String(
        error?.response?.code || error?.code || '',
      );
      if (
        [
          'APPOINTMENT_EXTERNAL_CHANGE_RECONCILED',
          'CALENDAR_TIME_UNAVAILABLE',
        ].includes(errorCode)
      ) {
        throw error;
      }
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
        if (timingChanged) {
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
      if (saved.status !== previousStatus || timingChanged) {
        await this.notifications.createForTenant({
          tenantId: saved.tenantId,
          assignedUserId: saved.assignedUserId,
          eventType: cancelled
            ? 'appointment.cancelled'
            : timingChanged
              ? 'appointment.rescheduled'
              : 'appointment.updated',
          category: 'leads',
          severity: cancelled ? 'warning' : 'success',
          title: cancelled
            ? `Appointment with ${saved.lead.fullName} was cancelled`
            : timingChanged
              ? `Appointment with ${saved.lead.fullName} was rescheduled`
              : `Appointment with ${saved.lead.fullName} is ${saved.status}`,
          message: cancelled
            ? 'Google Calendar and RealtyTechAI were updated. Agree on the next step.'
            : 'Google Calendar, RealtyTechAI, and Today were updated.',
          deduplicationKey: timingChanged
            ? `appointment-rescheduled:${saved.id}:${saved.startsAt.toISOString()}:${saved.endsAt.toISOString()}`
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

  private async updateGoogleTimeWithConflictResolution(
    appointment: Appointment,
    startsAt: Date,
    endsAt: Date,
  ) {
    const update = (etag: string | null | undefined) =>
      this.calendar.updateBookingEvent({
        tenantId: appointment.tenantId,
        eventId: appointment.externalEventId!,
        etag,
        calendarId: appointment.externalCalendarId,
        start: startsAt,
        end: endsAt,
      });
    try {
      return await update(appointment.externalEventEtag);
    } catch (error: any) {
      if (this.providerErrorCode(error) !== 'GOOGLE_CALENDAR_CHANGED') {
        throw error;
      }
    }

    const latest = await this.calendar.getBookingEvent(
      appointment.tenantId,
      appointment.externalEventId!,
      appointment.externalCalendarId,
    );
    if (!latest || latest.status === 'cancelled') {
      await this.reconcileExternalGoogleState(appointment, latest);
      throw new ConflictException({
        code: 'APPOINTMENT_EXTERNAL_CHANGE_RECONCILED',
        message:
          'The Google event was cancelled outside RealtyTechAI. The appointment now matches Google; review it before making another change.',
      });
    }
    if (!latest.startsAt || !latest.endsAt) {
      await this.markAppointmentConflict(
        appointment,
        'GOOGLE_EVENT_TIME_MISSING',
      );
      throw new ConflictException({
        code: 'APPOINTMENT_EXTERNAL_CHANGE_RECONCILED',
        message:
          'The Google event changed into a format RealtyTechAI cannot safely reschedule. Review this appointment before retrying.',
      });
    }
    if (
      latest.startsAt.getTime() === startsAt.getTime() &&
      latest.endsAt.getTime() === endsAt.getTime()
    ) {
      return latest;
    }
    const onlyNonTimingDataChanged =
      latest.startsAt.getTime() === appointment.startsAt.getTime() &&
      latest.endsAt.getTime() === appointment.endsAt.getTime();
    if (onlyNonTimingDataChanged) {
      try {
        return await update(latest.etag);
      } catch (error: any) {
        if (this.providerErrorCode(error) !== 'GOOGLE_CALENDAR_CHANGED') {
          throw error;
        }
        const newest = await this.calendar.getBookingEvent(
          appointment.tenantId,
          appointment.externalEventId!,
          appointment.externalCalendarId,
        );
        await this.reconcileExternalGoogleState(appointment, newest);
        throw new ConflictException({
          code: 'APPOINTMENT_EXTERNAL_CHANGE_RECONCILED',
          message:
            'The Google event changed again while RealtyTechAI was rescheduling it. The latest provider state was reconciled; review it before retrying.',
        });
      }
    }

    await this.reconcileExternalGoogleState(appointment, latest);
    throw new ConflictException({
      code: 'APPOINTMENT_EXTERNAL_CHANGE_RECONCILED',
      message:
        'The Google event was rescheduled outside RealtyTechAI. The appointment now matches Google; review the new time before retrying.',
    });
  }

  private async cancelGoogleEventWithConflictResolution(
    appointment: Appointment,
  ) {
    const cancel = (etag: string | null | undefined) =>
      this.calendar.cancelBookingEvent({
        tenantId: appointment.tenantId,
        eventId: appointment.externalEventId!,
        etag,
        calendarId: appointment.externalCalendarId,
      });
    try {
      return await cancel(appointment.externalEventEtag);
    } catch (error: any) {
      if (this.providerErrorCode(error) !== 'GOOGLE_CALENDAR_CHANGED') {
        throw error;
      }
    }
    const latest = await this.calendar.getBookingEvent(
      appointment.tenantId,
      appointment.externalEventId!,
      appointment.externalCalendarId,
    );
    if (!latest || latest.status === 'cancelled') {
      return { cancelled: true };
    }
    try {
      return await cancel(latest.etag);
    } catch (error: any) {
      if (this.providerErrorCode(error) !== 'GOOGLE_CALENDAR_CHANGED') {
        throw error;
      }
      const newest = await this.calendar.getBookingEvent(
        appointment.tenantId,
        appointment.externalEventId!,
        appointment.externalCalendarId,
      );
      await this.reconcileExternalGoogleState(appointment, newest);
      throw new ConflictException({
        code: 'APPOINTMENT_EXTERNAL_CHANGE_RECONCILED',
        message:
          'The Google event changed again while RealtyTechAI was cancelling it. The latest provider state was reconciled; review it before retrying.',
      });
    }
  }

  private async updateProviderTimeWithConflictResolution(
    adapter: BookingProviderAdapter,
    appointment: Appointment,
    startsAt: Date,
    endsAt: Date,
    timeZone: string,
    mode: AppointmentMode,
  ) {
    const update = (version: string | null | undefined) =>
      adapter.updateAppointment({
        tenantId: appointment.tenantId,
        eventId: appointment.externalEventId!,
        inviteeId: appointment.externalInviteeId,
        resourceId: appointment.externalCalendarId,
        version,
        start: startsAt,
        end: endsAt,
        timeZone,
        mode,
      });
    try {
      return await update(appointment.externalEventEtag);
    } catch (error: any) {
      if (!this.isProviderVersionConflict(adapter, error)) throw error;
    }
    const latest = await adapter.getAppointment(
      appointment.tenantId,
      appointment.externalEventId!,
      appointment.externalCalendarId,
      appointment.externalInviteeId,
    );
    if (!latest || latest.status === 'cancelled') {
      await this.reconcileExternalProviderState(adapter, appointment, latest);
      throw new ConflictException({
        code: 'APPOINTMENT_EXTERNAL_CHANGE_RECONCILED',
        message: `The ${this.providerLabel(adapter)} appointment was cancelled outside RealtyTechAI. The internal appointment now matches it; review before retrying.`,
      });
    }
    if (!latest.startsAt || !latest.endsAt) {
      await this.markProviderAppointmentConflict(
        appointment,
        `${adapter.storedProvider.toUpperCase()}_EVENT_TIME_MISSING`,
        adapter,
      );
      throw new ConflictException({
        code: 'APPOINTMENT_EXTERNAL_CHANGE_RECONCILED',
        message:
          'The provider appointment no longer has a safe timed interval. Review it before retrying.',
      });
    }
    if (
      latest.startsAt.getTime() === startsAt.getTime() &&
      latest.endsAt.getTime() === endsAt.getTime()
    ) {
      return latest;
    }
    const onlyNonTimingDataChanged =
      latest.startsAt.getTime() === appointment.startsAt.getTime() &&
      latest.endsAt.getTime() === appointment.endsAt.getTime();
    if (onlyNonTimingDataChanged) {
      try {
        return await update(latest.version);
      } catch (error: any) {
        if (!this.isProviderVersionConflict(adapter, error)) throw error;
        const newest = await adapter.getAppointment(
          appointment.tenantId,
          appointment.externalEventId!,
          appointment.externalCalendarId,
          appointment.externalInviteeId,
        );
        await this.reconcileExternalProviderState(adapter, appointment, newest);
        throw new ConflictException({
          code: 'APPOINTMENT_EXTERNAL_CHANGE_RECONCILED',
          message:
            'The provider appointment changed again during rescheduling. The latest provider state was reconciled; review before retrying.',
        });
      }
    }
    await this.reconcileExternalProviderState(adapter, appointment, latest);
    throw new ConflictException({
      code: 'APPOINTMENT_EXTERNAL_CHANGE_RECONCILED',
      message:
        'The appointment was rescheduled outside RealtyTechAI. The internal appointment now matches the provider; review the time before retrying.',
    });
  }

  private async cancelProviderEventWithConflictResolution(
    adapter: BookingProviderAdapter,
    appointment: Appointment,
  ) {
    const cancel = (version: string | null | undefined) =>
      adapter.cancelAppointment({
        tenantId: appointment.tenantId,
        eventId: appointment.externalEventId!,
        inviteeId: appointment.externalInviteeId,
        resourceId: appointment.externalCalendarId,
        version,
      });
    try {
      return await cancel(appointment.externalEventEtag);
    } catch (error: any) {
      if (!this.isProviderVersionConflict(adapter, error)) throw error;
    }
    const latest = await adapter.getAppointment(
      appointment.tenantId,
      appointment.externalEventId!,
      appointment.externalCalendarId,
      appointment.externalInviteeId,
    );
    if (!latest || latest.status === 'cancelled') return { cancelled: true };
    try {
      return await cancel(latest.version);
    } catch (error: any) {
      if (!this.isProviderVersionConflict(adapter, error)) throw error;
      const newest = await adapter.getAppointment(
        appointment.tenantId,
        appointment.externalEventId!,
        appointment.externalCalendarId,
        appointment.externalInviteeId,
      );
      await this.reconcileExternalProviderState(adapter, appointment, newest);
      throw new ConflictException({
        code: 'APPOINTMENT_EXTERNAL_CHANGE_RECONCILED',
        message:
          'The provider appointment changed again during cancellation. The latest state was reconciled; review before retrying.',
      });
    }
  }

  private isProviderVersionConflict(
    adapter: BookingProviderAdapter,
    error: any,
  ) {
    const code = this.providerErrorCode(error);
    return (
      (adapter.storedProvider === 'google' &&
        code === 'GOOGLE_CALENDAR_CHANGED') ||
      (adapter.storedProvider === 'microsoft' &&
        code === 'MICROSOFT_EVENT_CHANGED')
    );
  }

  private isUncertainProviderCreate(error: any) {
    const code = this.providerErrorCode(error);
    return (
      /(?:TIMEOUT|TEMPORARY_FAILURE|RESULT_UNCERTAIN)$/.test(code) ||
      code === 'GOOGLE_EVENT_RESULT_UNCERTAIN' ||
      code === 'MICROSOFT_EVENT_RESULT_UNCERTAIN' ||
      code === 'CALENDLY_BOOKING_RESULT_UNCERTAIN'
    );
  }

  private providerLabel(adapter: BookingProviderAdapter) {
    return adapter.storedProvider === 'google'
      ? 'Google Calendar'
      : adapter.storedProvider === 'microsoft'
        ? 'Microsoft Outlook'
        : 'Calendly';
  }

  private async markProviderAppointmentConflict(
    appointment: Appointment,
    syncErrorCode: string,
    adapter: BookingProviderAdapter,
  ) {
    await this.appointments.update(
      { id: appointment.id, tenantId: appointment.tenantId },
      { syncStatus: 'needs_attention', syncErrorCode },
    );
    await this.operations.createTask({
      tenantId: appointment.tenantId,
      category: 'appointment_workflow',
      title: 'One provider appointment needs review',
      description: `The ${this.providerLabel(adapter)} connection remains available, but this appointment could not be reconciled safely. Review both records before retrying.`,
      priority: 'high',
      relatedEntityType: 'appointment',
      relatedEntityId: appointment.id,
      dedupeOpen: true,
    });
  }

  private async publishAppointmentChange(
    appointment: Appointment,
    eventType:
      | 'appointment.rescheduled'
      | 'appointment.cancelled'
      | 'appointment.updated',
  ) {
    if (eventType === 'appointment.updated') return;
    try {
      await this.crmEvents.publish(
        appointment.tenantId,
        eventType,
        {
          appointmentId: appointment.id,
          leadId: appointment.leadId,
          assignedToUserId: appointment.assignedUserId || null,
          startsAt: appointment.startsAt.toISOString(),
          endsAt: appointment.endsAt.toISOString(),
          timeZone: await this.tenantTimeZone(appointment.tenantId),
          status: appointment.status,
          provider: appointment.externalProvider,
          meetingMode: appointment.meetingMode || 'in_person',
          joinUrl: appointment.externalJoinUrl || null,
          source: appointment.source,
          testRunId: appointment.lead.testRunId || null,
        },
        {
          idempotencyKey: `${eventType}:${appointment.id}:${appointment.updatedAt?.toISOString() || appointment.startsAt.toISOString()}`,
        },
      );
    } catch {
      await this.operations.createTask({
        tenantId: appointment.tenantId,
        category: 'appointment_workflow',
        title: 'Appointment CRM publication needs attention',
        description:
          'The authoritative provider and RealtyTechAI appointment were updated, but the CRM event could not be queued. Retry the CRM delivery without changing the appointment.',
        priority: 'high',
        relatedEntityType: 'appointment',
        relatedEntityId: appointment.id,
        dedupeOpen: true,
      });
    }
  }

  private providerErrorCode(error: any) {
    return String(error?.response?.code || error?.code || '');
  }

  private async markAppointmentConflict(
    appointment: Appointment,
    syncErrorCode: string,
  ) {
    await this.appointments.update(
      { id: appointment.id, tenantId: appointment.tenantId },
      { syncStatus: 'needs_attention', syncErrorCode },
    );
    await this.operations.createTask({
      tenantId: appointment.tenantId,
      category: 'appointment_workflow',
      title: 'A Google appointment needs individual review',
      description:
        'The provider connection is still available, but this appointment could not be reconciled safely. Review the Google event and RealtyTechAI appointment before retrying.',
      priority: 'high',
      relatedEntityType: 'appointment',
      relatedEntityId: appointment.id,
      dedupeOpen: true,
    });
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
    externalProvider?: NonNullable<Appointment['externalProvider']>;
    externalConnectionId?: string | null;
    externalInviteeId?: string | null;
    externalJoinUrl?: string | null;
    externalCancelUrl?: string | null;
    externalRescheduleUrl?: string | null;
    externalProviderUpdatedAt?: Date | null;
    meetingMode?: AppointmentMode;
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
          calendarSource:
            input.externalProvider === 'microsoft'
              ? 'Microsoft Outlook'
              : input.externalProvider === 'calendly'
                ? 'Calendly'
                : 'Google Calendar',
          confirmationStatus: 'pending',
          confirmationTaskCreatedAt: new Date(),
          reminderStatus: 'scheduled',
          reminderSentAt: null,
          followUpStatus: 'not_due',
          notes: input.notes,
          meetingMode: input.meetingMode || 'in_person',
          externalEventId: input.externalEventId,
          externalEventEtag: input.externalEventEtag,
          externalProvider: input.externalProvider || 'google',
          externalCalendarId: input.externalCalendarId,
          externalConnectionId: input.externalConnectionId || null,
          externalInviteeId: input.externalInviteeId || null,
          externalJoinUrl: input.externalJoinUrl || null,
          externalCancelUrl: input.externalCancelUrl || null,
          externalRescheduleUrl: input.externalRescheduleUrl || null,
          externalProviderUpdatedAt:
            input.externalProviderUpdatedAt || null,
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
            externalProvider: input.externalProvider || 'google',
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
    const providerName =
      appointment.externalProvider === 'microsoft'
        ? 'Microsoft Outlook'
        : appointment.externalProvider === 'calendly'
          ? 'Calendly'
          : 'Google Calendar';
    const createdNotifications = await this.notifications.createForTenant({
      tenantId: appointment.tenantId,
      assignedUserId: appointment.assignedUserId,
      eventType: 'appointment.created',
      category: 'leads',
      severity: 'success',
      title: `Appointment scheduled with ${appointment.lead.fullName}`,
      message: `The time is verified and the appointment is confirmed by ${providerName}.`,
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
        endsAt: appointment.endsAt.toISOString(),
        timeZone: await this.tenantTimeZone(appointment.tenantId),
        status: appointment.status,
        source: appointment.source,
        provider: appointment.externalProvider,
        externalProvider: appointment.externalProvider,
        meetingMode: appointment.meetingMode || 'in_person',
        joinUrl: appointment.externalJoinUrl || null,
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
        provider: appointment.externalProvider,
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
          bookingProvider:
            appointment.externalProvider === 'microsoft'
              ? 'microsoft_calendar'
              : appointment.externalProvider === 'calendly'
                ? 'calendly'
                : 'google_calendar',
        },
      );
    }
    appointment.postCommitCompletedAt = new Date();
    await this.appointments.save(appointment);
  }

  private async reconcileExternalProviderState(
    adapter: BookingProviderAdapter,
    appointment: Appointment,
    external: ProviderAppointment | null,
  ) {
    const cancelled = !external || external.status === 'cancelled';
    if (!cancelled && (!external.startsAt || !external.endsAt)) {
      await this.markProviderAppointmentConflict(
        appointment,
        `${adapter.storedProvider.toUpperCase()}_EVENT_TIME_MISSING`,
        adapter,
      );
      throw new Error('Provider appointment has no timed start/end');
    }
    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Appointment);
      const locked = await repository
        .createQueryBuilder('appointment')
        .leftJoinAndSelect('appointment.lead', 'lead')
        .setLock('pessimistic_write')
        .where(
          'appointment.id = :id AND appointment.tenantId = :tenantId',
          { id: appointment.id, tenantId: appointment.tenantId },
        )
        .getOneOrFail();
      const timingChanged = Boolean(
        !cancelled &&
          external?.startsAt &&
          external?.endsAt &&
          (external.startsAt.getTime() !== locked.startsAt.getTime() ||
            external.endsAt.getTime() !== locked.endsAt.getTime()),
      );
      const cancellationChanged = cancelled && locked.status !== 'cancelled';
      const meetingMetadataChanged = Boolean(
        external &&
          (external.joinUrl || null) !== (locked.externalJoinUrl || null),
      );
      locked.externalEventEtag = external?.version || null;
      locked.externalConnectionId =
        external?.connectionId || locked.externalConnectionId || null;
      locked.externalInviteeId =
        external?.inviteeId || locked.externalInviteeId || null;
      locked.externalJoinUrl = external?.joinUrl || null;
      locked.externalCancelUrl =
        external?.cancelUrl || locked.externalCancelUrl || null;
      locked.externalRescheduleUrl =
        external?.rescheduleUrl || locked.externalRescheduleUrl || null;
      locked.externalProviderUpdatedAt =
        external?.providerUpdatedAt || null;
      locked.lastSyncedAt = new Date();
      locked.syncStatus = 'synced';
      locked.syncErrorCode = null;
      if (timingChanged && external?.startsAt && external.endsAt) {
        locked.startsAt = external.startsAt;
        locked.endsAt = external.endsAt;
        locked.confirmationStatus = 'pending';
        locked.reminderStatus = 'scheduled';
        locked.reminderSentAt = null;
        locked.lead.nextFollowUpAt = external.startsAt;
        locked.lead.recommendedNextAction =
          'Review the externally changed appointment time and confirm it with the lead.';
        await manager.getRepository(Lead).save(locked.lead);
      }
      if (cancellationChanged) {
        locked.status = 'cancelled';
        locked.reminderStatus = 'cancelled';
        locked.followUpStatus =
          locked.followUpStatus === 'completed' ? 'completed' : 'due';
        locked.lead.nextFollowUpAt = new Date();
        locked.lead.recommendedNextAction =
          'The provider appointment was cancelled. Contact the lead and agree on the next step.';
        if (locked.lead.stage === 'appointment_set') {
          const otherUpcoming = await repository.count({
            where: {
              id: Not(locked.id),
              leadId: locked.leadId,
              status: In(['scheduled', 'confirmed']),
            },
          });
          if (!otherUpcoming) {
            const previousStage = locked.lead.stage;
            locked.lead.stage = 'qualified';
            await manager.getRepository(LeadStageEvent).save(
              manager.getRepository(LeadStageEvent).create({
                tenantId: locked.tenantId,
                leadId: locked.leadId,
                previousStage,
                newStage: locked.lead.stage,
                changedByUserId: null,
                changeSource: 'external_calendar_reconciliation',
              }),
            );
          }
        }
        await manager.getRepository(Lead).save(locked.lead);
      }
      const saved = await repository.save(locked);
      if (timingChanged || cancellationChanged || meetingMetadataChanged) {
        await manager.getRepository(LeadEvent).save(
          manager.getRepository(LeadEvent).create({
            lead: locked.lead,
            eventType: 'appointment_reconciled',
            metadata: {
              appointmentId: locked.id,
              externalProvider: adapter.storedProvider,
              change: cancellationChanged
                ? 'cancelled'
                : timingChanged
                  ? 'rescheduled'
                  : 'meeting_metadata',
            },
          }),
        );
      }
      return {
        saved,
        timingChanged,
        cancellationChanged,
        meetingMetadataChanged,
      };
    });
    if (
      result.timingChanged ||
      result.cancellationChanged ||
      result.meetingMetadataChanged
    ) {
      const change = result.cancellationChanged
        ? 'cancelled'
        : result.timingChanged
          ? 'rescheduled'
          : 'meeting details changed';
      await this.notifications.createForTenant({
        tenantId: result.saved.tenantId,
        assignedUserId: result.saved.assignedUserId,
        eventType: 'appointment.reconciled',
        category: 'leads',
        severity: 'warning',
        title: `Provider change reconciled for ${result.saved.lead.fullName}`,
        message: `${this.providerLabel(adapter)} ${change} outside RealtyTechAI. The internal appointment now matches it.`,
        deduplicationKey: `appointment-reconciled:${result.saved.id}:${result.saved.updatedAt?.toISOString() || result.saved.startsAt.toISOString()}`,
        actionUrl: `/app/appointments?appointmentId=${result.saved.id}`,
        entityType: 'appointment',
        entityId: result.saved.id,
      });
      await this.audit.recordSystemEvent({
        tenantId: result.saved.tenantId,
        eventType: 'appointment.external_change_reconciled',
        resourceType: 'appointment',
        resourceId: result.saved.id,
        metadata: { provider: adapter.storedProvider, change },
      });
      try {
        await this.crmEvents.publish(
          result.saved.tenantId,
          'appointment.reconciled',
          {
            appointmentId: result.saved.id,
            leadId: result.saved.leadId,
            startsAt: result.saved.startsAt.toISOString(),
            endsAt: result.saved.endsAt.toISOString(),
            status: result.saved.status,
            provider: result.saved.externalProvider,
            meetingMode: result.saved.meetingMode || 'in_person',
            joinUrl: result.saved.externalJoinUrl || null,
            change,
          },
          {
            idempotencyKey: `appointment.reconciled:${result.saved.id}:${result.saved.updatedAt?.toISOString() || change}`,
          },
        );
      } catch {
        await this.operations.createTask({
          tenantId: result.saved.tenantId,
          category: 'appointment_workflow',
          title: 'Reconciled appointment CRM event needs attention',
          description:
            'Provider and internal records match, but the reconciliation event could not be queued for CRM delivery.',
          priority: 'high',
          relatedEntityType: 'appointment',
          relatedEntityId: result.saved.id,
          dedupeOpen: true,
        });
      }
    }
    return result.saved;
  }

  private async reconcileExternalGoogleState(
    appointment: Appointment,
    external: {
      etag: string | null;
      status: string;
      startsAt: Date | null;
      endsAt: Date | null;
    } | null,
  ) {
    const cancelled = !external || external.status === 'cancelled';
    if (!cancelled && (!external.startsAt || !external.endsAt)) {
      await this.markAppointmentConflict(
        appointment,
        'GOOGLE_EVENT_TIME_MISSING',
      );
      throw new Error('Google Calendar event has no timed start/end');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Appointment);
      const locked = await repository
        .createQueryBuilder('appointment')
        .leftJoinAndSelect('appointment.lead', 'lead')
        .setLock('pessimistic_write')
        .where(
          'appointment.id = :id AND appointment.tenantId = :tenantId',
          { id: appointment.id, tenantId: appointment.tenantId },
        )
        .getOneOrFail();
      const timingChanged = Boolean(
        !cancelled &&
          external?.startsAt &&
          external?.endsAt &&
          (external.startsAt.getTime() !== locked.startsAt.getTime() ||
            external.endsAt.getTime() !== locked.endsAt.getTime()),
      );
      const cancellationChanged = cancelled && locked.status !== 'cancelled';

      locked.externalEventEtag = external?.etag || null;
      locked.lastSyncedAt = new Date();
      locked.syncStatus = 'synced';
      locked.syncErrorCode = null;
      if (timingChanged && external?.startsAt && external.endsAt) {
        locked.startsAt = external.startsAt;
        locked.endsAt = external.endsAt;
        locked.confirmationStatus = 'pending';
        locked.reminderStatus = 'scheduled';
        locked.reminderSentAt = null;
        locked.lead.nextFollowUpAt = external.startsAt;
        locked.lead.recommendedNextAction =
          'Review the externally changed appointment time and confirm it with the lead.';
        await manager.getRepository(Lead).save(locked.lead);
      }
      if (cancellationChanged) {
        locked.status = 'cancelled';
        locked.reminderStatus = 'cancelled';
        locked.followUpStatus =
          locked.followUpStatus === 'completed' ? 'completed' : 'due';
        locked.lead.nextFollowUpAt = new Date();
        locked.lead.recommendedNextAction =
          'The calendar appointment was cancelled. Contact the lead and agree on the next step.';
        if (locked.lead.stage === 'appointment_set') {
          const otherUpcoming = await repository.count({
            where: {
              id: Not(locked.id),
              leadId: locked.leadId,
              status: In(['scheduled', 'confirmed']),
            },
          });
          if (!otherUpcoming) {
            const previousStage = locked.lead.stage;
            locked.lead.stage = 'qualified';
            await manager.getRepository(LeadStageEvent).save(
              manager.getRepository(LeadStageEvent).create({
                tenantId: locked.tenantId,
                leadId: locked.leadId,
                previousStage,
                newStage: locked.lead.stage,
                changedByUserId: null,
                changeSource: 'external_calendar_reconciliation',
              }),
            );
          }
        }
        await manager.getRepository(Lead).save(locked.lead);
      }
      const saved = await repository.save(locked);
      if (timingChanged || cancellationChanged) {
        await manager.getRepository(LeadEvent).save(
          manager.getRepository(LeadEvent).create({
            lead: locked.lead,
            eventType: 'appointment_reconciled',
            metadata: {
              appointmentId: locked.id,
              externalProvider: 'google',
              change: cancellationChanged ? 'cancelled' : 'rescheduled',
            },
          }),
        );
      }
      return { saved, timingChanged, cancellationChanged };
    });

    if (result.timingChanged || result.cancellationChanged) {
      await this.notifications.createForTenant({
        tenantId: result.saved.tenantId,
        assignedUserId: result.saved.assignedUserId,
        eventType: 'appointment.reconciled',
        category: 'leads',
        severity: 'warning',
        title: `Calendar change reconciled for ${result.saved.lead.fullName}`,
        message: result.cancellationChanged
          ? 'The Google event was cancelled outside RealtyTechAI. The internal appointment now matches it.'
          : 'The Google Calendar time changed outside RealtyTechAI. The internal appointment now matches it.',
        deduplicationKey: result.cancellationChanged
          ? `appointment-reconciled:${result.saved.id}:cancelled`
          : `appointment-reconciled:${result.saved.id}:${result.saved.startsAt.toISOString()}:${result.saved.endsAt.toISOString()}`,
        actionUrl: `/app/appointments?appointmentId=${result.saved.id}`,
        entityType: 'appointment',
        entityId: result.saved.id,
      });
      await this.audit.recordSystemEvent({
        tenantId: result.saved.tenantId,
        eventType: 'appointment.external_change_reconciled',
        resourceType: 'appointment',
        resourceId: result.saved.id,
        metadata: {
          provider: 'google',
          change: result.cancellationChanged ? 'cancelled' : 'rescheduled',
        },
      });
    }
    return result.saved;
  }

  private async reconcile(appointmentId: string) {
    const candidate = await this.appointments.findOne({
      where: { id: appointmentId },
      relations: ['lead'],
    });
    if (
      !candidate ||
      !candidate.externalProvider ||
      !candidate.externalEventId ||
      ['completed', 'no_show'].includes(candidate.status)
    ) {
      return;
    }
    if (this.providers) {
      const adapter = this.providers.forStoredProvider(candidate.externalProvider);
      return this.providers.withTenantBookingLock(
        adapter.name,
        candidate.tenantId,
        async () => {
          const appointment = await this.appointments.findOne({
            where: { id: appointmentId, tenantId: candidate.tenantId },
            relations: ['lead'],
          });
          if (
            !appointment ||
            !appointment.externalProvider ||
            !appointment.externalEventId ||
            ['completed', 'no_show'].includes(appointment.status)
          ) {
            return;
          }
          const boundAdapter = this.providers!.forStoredProvider(
            appointment.externalProvider,
          );
          const external = await boundAdapter.getAppointment(
            appointment.tenantId,
            appointment.externalEventId,
            appointment.externalCalendarId,
            appointment.externalInviteeId,
          );
          const reconciled = await this.reconcileExternalProviderState(
            boundAdapter,
            appointment,
            external,
          );
          if (
            reconciled.status !== 'cancelled' &&
            reconciled.startsAt > new Date()
          ) {
            return { nextRunAt: new Date(Date.now() + 6 * 60 * 60_000) };
          }
        },
      );
    }
    if (candidate.externalProvider !== 'google') return;
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
      const reconciled = await this.reconcileExternalGoogleState(
        appointment,
        external,
      );
      if (reconciled.status !== 'cancelled' && reconciled.startsAt > new Date()) {
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
    provider?: BookingProviderName;
    meetingMode?: AppointmentMode;
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
        resourceId: input.calendarId,
        provider: input.provider || '',
        meetingMode: input.meetingMode || '',
      },
      maxAttempts: 8,
    });
  }

  private scheduleReconciliation(appointment: Appointment) {
    if (!appointment.externalProvider || !appointment.externalEventId) {
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
