import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { hasAtLeastRole, UserRole } from '../../common/rbac';
import { operationalEvent } from '../../common/operational-log';
import { NotificationsService } from '../notifications/notifications.service';
import { Appointment } from './appointment.entity';
import { LeadHandoff } from './lead-handoff.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { CreateAppointmentDto, UpdateAppointmentDto, UpdateHandoffDto } from './client-operations.dto';

type AccessContext = { userId?: string; role?: UserRole };

type ClientLead = {
  id: string;
  fullName: string;
  leadType: string;
  temperature: string;
  temperatureReason: string;
  source: string;
  readiness: string;
  blocker: string | null;
  timeline: string | null;
  budget: string | null;
  phone: string | null;
  email: string | null;
  assignedAgent: string;
  recommendedNextAction: string | null;
  nextFollowUpAt: Date | null;
  conversationSummary: string | null;
  talkingPoints: string[];
};

type ClientAppointment = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  calendarSource: string;
  confirmationStatus: string;
  followUpStatus: string;
  notes: string | null;
};

type TodayAction = {
  id: string;
  resourceType: 'handoff' | 'appointment' | 'lead' | 'message';
  resourceId: string;
  kind: 'human_handoff' | 'appointment' | 'follow_up' | 'message_problem' | 'new_lead';
  priority: 'urgent' | 'high' | 'normal';
  title: string;
  reason: string;
  nextAction: string;
  dueAt: Date | null;
  href: string;
  primaryAction: 'call' | 'text' | 'email' | 'open' | 'confirm';
  availableActions: Array<'call' | 'text' | 'email' | 'view' | 'complete' | 'snooze' | 'reschedule' | 'note'>;
  lead: ClientLead;
  latestMessage: { body: string; direction: string; createdAt: Date } | null;
  appointment: ClientAppointment | null;
  score: number;
};

@Injectable()
export class ClientOperationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClientOperationsService.name);
  private escalationTimer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(LeadHandoff)
    private readonly handoffs: Repository<LeadHandoff>,
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    @InjectRepository(Lead)
    private readonly leads: Repository<Lead>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(LeadEvent)
    private readonly events: Repository<LeadEvent>,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.escalationTimer = setInterval(
      () => void this.runOperationalChecks().catch((error: unknown) => {
        this.logger.error(
          operationalEvent('client_operations_check_failed', {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }),
      60_000,
    );
    this.escalationTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.escalationTimer) clearInterval(this.escalationTimer);
  }

  private canSeeAll(ctx?: AccessContext) {
    return ctx?.role ? hasAtLeastRole(ctx.role, 'admin') : true;
  }

  private addLeadScope(query: any, ctx?: AccessContext, leadAlias = 'lead') {
    if (!this.canSeeAll(ctx)) {
      query.andWhere(`${leadAlias}.assignedToUserId = :scopeUserId`, {
        scopeUserId: ctx?.userId || '00000000-0000-0000-0000-000000000000',
      });
    }
    return query;
  }

  private clientLead(lead: Lead, assignedEmail?: string | null) {
    return {
      id: lead.id,
      fullName: lead.fullName,
      leadType: lead.leadType,
      temperature: lead.temperature,
      temperatureReason: lead.temperatureReason,
      source: lead.source || 'Unknown source',
      readiness: lead.readinessLevel,
      blocker: lead.mainBlocker || null,
      timeline: lead.timeline || null,
      budget: lead.budgetRange || lead.estimatedPrice || null,
      phone: lead.phone || null,
      email: lead.email || null,
      assignedAgent: lead.assignedTo || assignedEmail || 'Unassigned',
      recommendedNextAction: lead.recommendedNextAction || null,
      nextFollowUpAt: lead.nextFollowUpAt || null,
      conversationSummary: lead.conversationSummary || null,
      talkingPoints: lead.recommendedTalkingPoints || [],
    };
  }

  private clientAppointment(appointment: Appointment) {
    return {
      id: appointment.id,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      calendarSource: appointment.calendarSource,
      confirmationStatus: appointment.confirmationStatus,
      followUpStatus: appointment.followUpStatus,
      notes: appointment.notes || null,
    };
  }

  async getToday(tenantId: string, ctx?: AccessContext, requestedLimit = 8) {
    if (!tenantId) throw new ForbiddenException('Missing tenant');
    const parsedLimit = Number(requestedLimit);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 8)
      : 8;
    const now = new Date();
    const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const handoffQuery = this.handoffs
      .createQueryBuilder('handoff')
      .leftJoinAndSelect('handoff.lead', 'lead')
      .leftJoinAndSelect('handoff.assignedUser', 'handoffUser')
      .leftJoinAndSelect('lead.assignedToUser', 'leadUser')
      .where('handoff.tenantId = :tenantId', { tenantId })
      .andWhere('handoff.status IN (:...handoffStatuses)', {
        handoffStatuses: ['open', 'opened', 'snoozed'],
      })
      .andWhere('(handoff.status != :snoozed OR handoff.snoozedUntil <= :now)', {
        snoozed: 'snoozed',
        now,
      })
      .orderBy('handoff.dueAt', 'ASC', 'NULLS FIRST')
      .take(20);
    this.addLeadScope(handoffQuery, ctx);

    const appointmentQuery = this.appointments
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.lead', 'lead')
      .leftJoinAndSelect('appointment.assignedUser', 'appointmentUser')
      .leftJoinAndSelect('lead.assignedToUser', 'leadUser')
      .where('appointment.tenantId = :tenantId', { tenantId })
      .andWhere('appointment.status IN (:...appointmentStatuses)', {
        appointmentStatuses: ['scheduled', 'confirmed'],
      })
      .andWhere('appointment.startsAt >= :appointmentStart', {
        appointmentStart: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      })
      .andWhere('appointment.startsAt <= :appointmentEnd', { appointmentEnd: sevenDays })
      .orderBy('appointment.startsAt', 'ASC')
      .take(20);
    this.addLeadScope(appointmentQuery, ctx);

    const failedMessageQuery = this.messages
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.lead', 'lead')
      .leftJoinAndSelect('lead.assignedToUser', 'leadUser')
      .where('lead.tenantId = :tenantId', { tenantId })
      .andWhere('message.status = :failedStatus', { failedStatus: 'failed' })
      .andWhere('message.createdAt >= :failureStart', { failureStart: sevenDaysAgo })
      .orderBy('message.createdAt', 'DESC')
      .take(20);
    this.addLeadScope(failedMessageQuery, ctx);

    const followUpQuery = this.leads
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.assignedToUser', 'leadUser')
      .where('lead.tenantId = :tenantId', { tenantId })
      .andWhere('lead.nextFollowUpAt IS NOT NULL')
      .andWhere('lead.nextFollowUpAt <= :now', { now })
      .andWhere('lead.stage NOT IN (:...finishedStages)', {
        finishedStages: ['closed', 'lost'],
      })
      .orderBy('lead.nextFollowUpAt', 'ASC')
      .take(20);
    this.addLeadScope(followUpQuery, ctx);

    const newLeadQuery = this.leads
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.assignedToUser', 'leadUser')
      .where('lead.tenantId = :tenantId', { tenantId })
      .andWhere('lead.createdAt >= :oneDayAgo', { oneDayAgo })
      .andWhere('lead.firstContactSentAt IS NULL')
      .andWhere('lead.stage = :newStage', { newStage: 'new' })
      .orderBy('lead.createdAt', 'ASC')
      .take(20);
    this.addLeadScope(newLeadQuery, ctx);

    const [handoffRows, appointmentRows, failedRows, followUpRows, newLeadRows] =
      await Promise.all([
        handoffQuery.getMany(),
        appointmentQuery.getMany(),
        failedMessageQuery.getMany(),
        followUpQuery.getMany(),
        newLeadQuery.getMany(),
      ]);

    const candidateLeadIds = Array.from(
      new Set([
        ...handoffRows.map((row) => row.leadId),
        ...appointmentRows.map((row) => row.leadId),
        ...failedRows.map((row) => row.leadId),
        ...followUpRows.map((row) => row.id),
        ...newLeadRows.map((row) => row.id),
      ]),
    );
    const recentMessages = candidateLeadIds.length
      ? await this.messages.find({
          where: { leadId: In(candidateLeadIds) },
          order: { createdAt: 'DESC' },
        })
      : [];
    const latestByLead = new Map<string, Message>();
    for (const message of recentMessages) {
      if (!latestByLead.has(message.leadId)) latestByLead.set(message.leadId, message);
    }
    const appointmentByLead = new Map<string, Appointment>();
    for (const appointment of appointmentRows) {
      if (!appointmentByLead.has(appointment.leadId)) {
        appointmentByLead.set(appointment.leadId, appointment);
      }
    }

    const latest = (leadId: string) => {
      const message = latestByLead.get(leadId);
      return message
        ? {
            body: message.body.slice(0, 280),
            direction: message.direction,
            createdAt: message.createdAt,
          }
        : null;
    };
    const appointmentFor = (leadId: string) => {
      const item = appointmentByLead.get(leadId);
      return item ? this.clientAppointment(item) : null;
    };
    const actions: TodayAction[] = [];

    for (const handoff of handoffRows) {
      const lead = handoff.lead;
      const preferredContact = lead.phone ? 'call' : lead.email ? 'email' : 'open';
      actions.push({
        id: `handoff:${handoff.id}`,
        resourceType: 'handoff',
        resourceId: handoff.id,
        kind: 'human_handoff',
        priority: handoff.priority,
        title: `${lead.fullName} needs a personal follow-up`,
        reason: handoff.reason,
        nextAction: handoff.recommendedAction,
        dueAt: handoff.dueAt || null,
        href: `/app/inbox?leadId=${lead.id}`,
        primaryAction: preferredContact,
        availableActions: ['call', 'text', 'email', 'view', 'complete', 'snooze', 'note'],
        lead: this.clientLead(lead, handoff.assignedUser?.email),
        latestMessage: latest(lead.id),
        appointment: appointmentFor(lead.id),
        score: handoff.priority === 'urgent' ? 110 : handoff.priority === 'high' ? 100 : 80,
      });
    }

    for (const message of failedRows) {
      const lead = message.lead;
      const resolvedByLaterSend = recentMessages.some(
        (candidate) =>
          candidate.leadId === message.leadId &&
          candidate.direction === 'outbound' &&
          ['provider_accepted', 'sent', 'delivered'].includes(candidate.status) &&
          candidate.createdAt.getTime() > message.createdAt.getTime(),
      );
      if (resolvedByLaterSend) continue;
      actions.push({
        id: `message:${message.id}`,
        resourceType: 'message',
        resourceId: message.id,
        kind: 'message_problem',
        priority: 'urgent',
        title: `A message to ${lead.fullName} did not send`,
        reason: 'The lead may still be waiting for a response.',
        nextAction: 'Open the conversation and send the message again.',
        dueAt: message.failedAt || message.createdAt,
        href: `/app/inbox?leadId=${lead.id}`,
        primaryAction: 'open',
        availableActions: ['view', 'call', 'text', 'email'],
        lead: this.clientLead(lead, lead.assignedToUser?.email),
        latestMessage: latest(lead.id),
        appointment: appointmentFor(lead.id),
        score: 105,
      });
    }

    for (const appointment of appointmentRows) {
      const lead = appointment.lead;
      const today = appointment.startsAt.toDateString() === now.toDateString();
      actions.push({
        id: `appointment:${appointment.id}`,
        resourceType: 'appointment',
        resourceId: appointment.id,
        kind: 'appointment',
        priority: today ? 'high' : 'normal',
        title: `${today ? 'Today' : 'Upcoming'}: ${lead.fullName}`,
        reason:
          appointment.confirmationStatus === 'pending'
            ? 'The appointment still needs confirmation.'
            : 'The appointment is confirmed.',
        nextAction:
          appointment.confirmationStatus === 'pending'
            ? 'Confirm the appointment with the lead.'
            : 'Review the conversation before the meeting.',
        dueAt: appointment.startsAt,
        href: `/app/appointments?appointmentId=${appointment.id}`,
        primaryAction: appointment.confirmationStatus === 'pending' ? 'confirm' : 'open',
        availableActions: ['view', 'call', 'text', 'reschedule', 'note'],
        lead: this.clientLead(lead, appointment.assignedUser?.email),
        latestMessage: latest(lead.id),
        appointment: this.clientAppointment(appointment),
        score: today ? 95 : 65,
      });
    }

    for (const lead of followUpRows) {
      actions.push({
        id: `follow-up:${lead.id}`,
        resourceType: 'lead',
        resourceId: lead.id,
        kind: 'follow_up',
        priority: lead.temperature === 'hot' ? 'high' : 'normal',
        title: `Follow up with ${lead.fullName}`,
        reason: lead.temperatureReason,
        nextAction: lead.recommendedNextAction || 'Check in and record the outcome.',
        dueAt: lead.nextFollowUpAt || null,
        href: `/app/inbox?leadId=${lead.id}`,
        primaryAction: lead.phone ? 'call' : lead.email ? 'email' : 'open',
        availableActions: ['call', 'text', 'email', 'view', 'note'],
        lead: this.clientLead(lead, lead.assignedToUser?.email),
        latestMessage: latest(lead.id),
        appointment: appointmentFor(lead.id),
        score: lead.temperature === 'hot' ? 90 : 70,
      });
    }

    for (const lead of newLeadRows) {
      actions.push({
        id: `new-lead:${lead.id}`,
        resourceType: 'lead',
        resourceId: lead.id,
        kind: 'new_lead',
        priority: 'high',
        title: `${lead.fullName} has not received a first response`,
        reason: 'This new lead entered recently and is still waiting.',
        nextAction: 'Open the lead and make first contact now.',
        dueAt: lead.createdAt,
        href: `/app/inbox?leadId=${lead.id}`,
        primaryAction: lead.phone ? 'text' : lead.email ? 'email' : 'open',
        availableActions: ['call', 'text', 'email', 'view'],
        lead: this.clientLead(lead, lead.assignedToUser?.email),
        latestMessage: latest(lead.id),
        appointment: appointmentFor(lead.id),
        score: 98,
      });
    }

    actions.sort((a, b) => b.score - a.score || Number(a.dueAt || 0) - Number(b.dueAt || 0));
    const selected: TodayAction[] = [];
    const seenLeads = new Set<string>();
    for (const action of actions) {
      if (seenLeads.has(action.lead.id)) continue;
      seenLeads.add(action.lead.id);
      selected.push(action);
      if (selected.length === limit) break;
    }

    return {
      generatedAt: now,
      actionCount: selected.length,
      headline: selected.length
        ? `${selected.length} ${selected.length === 1 ? 'person needs' : 'people need'} your attention`
        : "You're caught up",
      guidance: selected.length
        ? 'Start at the top. RealtyTechAI has already organized the reason and next step.'
        : 'RealtyTechAI is still watching for replies, appointments, and problems.',
      actions: selected.map(({ score: _score, ...action }) => action),
    };
  }

  async updateHandoff(id: string, tenantId: string | null, dto: UpdateHandoffDto, ctx?: AccessContext) {
    const query = this.handoffs
      .createQueryBuilder('handoff')
      .leftJoinAndSelect('handoff.lead', 'lead')
      .where('handoff.id = :id', { id });
    if (tenantId) query.andWhere('handoff.tenantId = :tenantId', { tenantId });
    this.addLeadScope(query, ctx);
    const handoff = await query.getOne();
    if (!handoff) throw new NotFoundException('Handoff not found');
    const now = new Date();
    if (dto.action === 'opened') {
      handoff.status = 'opened';
      handoff.openedAt = handoff.openedAt || now;
    }
    if (dto.action === 'completed') {
      handoff.status = 'completed';
      handoff.completedAt = now;
      handoff.completionNote = dto.note?.trim() || null;
    }
    if (dto.action === 'snoozed') {
      const until = dto.snoozedUntil ? new Date(dto.snoozedUntil) : new Date(now.getTime() + 24 * 60 * 60 * 1000);
      if (Number.isNaN(until.getTime()) || until <= now) {
        throw new BadRequestException('Choose a future time to snooze this follow-up');
      }
      if (until.getTime() > now.getTime() + 90 * 24 * 60 * 60 * 1000) {
        throw new BadRequestException('A handoff cannot be snoozed for more than 90 days');
      }
      handoff.status = 'snoozed';
      handoff.snoozedUntil = until;
      handoff.completionNote = dto.note?.trim() || handoff.completionNote || null;
    }
    const saved = await this.handoffs.save(handoff);
    await this.events.save(
      this.events.create({
        lead: handoff.lead,
        eventType: `handoff_${dto.action}`,
        metadata: { handoffId: handoff.id, note: dto.note || null },
      }),
    );
    return saved;
  }

  async listAppointments(tenantId: string, ctx?: AccessContext, status?: string) {
    const query = this.appointments
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.lead', 'lead')
      .leftJoinAndSelect('appointment.assignedUser', 'assignedUser')
      .where('appointment.tenantId = :tenantId', { tenantId })
      .orderBy('appointment.startsAt', 'ASC');
    if (status && ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'].includes(status)) {
      query.andWhere('appointment.status = :status', { status });
    }
    this.addLeadScope(query, ctx);
    return query.getMany();
  }

  async createAppointment(
    tenantId: string,
    dto: CreateAppointmentDto,
    ctx?: AccessContext,
    source: Appointment['source'] = 'manual',
  ) {
    const lead = await this.requireLeadAccess(tenantId, dto.leadId, ctx);
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : new Date(startsAt.getTime() + 30 * 60 * 1000);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException('Appointment end time must be after its start time');
    }
    const appointment = await this.appointments.save(
      this.appointments.create({
        tenantId,
        leadId: lead.id,
        lead,
        assignedUserId: lead.assignedToUserId || ctx?.userId || null,
        startsAt,
        endsAt,
        status: 'scheduled',
        source,
        calendarSource: dto.calendarSource?.trim() || 'RealtyTechAI',
        confirmationStatus: 'pending',
        confirmationTaskCreatedAt: new Date(),
        reminderStatus: 'scheduled',
        reminderSentAt: null,
        followUpStatus: 'not_due',
        notes: dto.notes?.trim() || null,
        externalEventId: dto.externalEventId?.trim() || null,
      }),
    );
    lead.stage = 'appointment_set';
    lead.recommendedNextAction = 'Prepare for the appointment and confirm the time.';
    lead.nextFollowUpAt = startsAt;
    await this.leads.save(lead);
    await this.events.save(
      this.events.create({
        lead,
        eventType: 'appointment_created',
        metadata: { appointmentId: appointment.id, source },
      }),
    );
    await this.notifications.createForTenant({
      tenantId,
      assignedUserId: appointment.assignedUserId,
      eventType: 'appointment.created',
      category: 'leads',
      severity: 'success',
      title: `Appointment scheduled with ${lead.fullName}`,
      message: 'Open RealtyTechAI to confirm the time and review the conversation.',
      deduplicationKey: `appointment-created:${appointment.id}`,
      actionUrl: `/app/appointments?appointmentId=${appointment.id}`,
      entityType: 'appointment',
      entityId: appointment.id,
    });
    return appointment;
  }

  async updateAppointment(
    id: string,
    tenantId: string | null,
    dto: UpdateAppointmentDto,
    ctx?: AccessContext,
  ) {
    const query = this.appointments
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.lead', 'lead')
      .where('appointment.id = :id', { id });
    if (tenantId) query.andWhere('appointment.tenantId = :tenantId', { tenantId });
    this.addLeadScope(query, ctx);
    const appointment = await query.getOne();
    if (!appointment) throw new NotFoundException('Appointment not found');
    const previousStatus = appointment.status;
    const previousStartsAt = appointment.startsAt;
    const previousDurationMs = Math.max(appointment.endsAt.getTime() - appointment.startsAt.getTime(), 30 * 60 * 1000);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : appointment.startsAt;
    let endsAt = dto.endsAt ? new Date(dto.endsAt) : appointment.endsAt;
    if (dto.startsAt && !dto.endsAt) endsAt = new Date(startsAt.getTime() + previousDurationMs);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException('Appointment end time must be after its start time');
    }
    appointment.startsAt = startsAt;
    appointment.endsAt = endsAt;
    if (dto.status) appointment.status = dto.status;
    if (dto.confirmationStatus) appointment.confirmationStatus = dto.confirmationStatus;
    if (dto.followUpStatus) appointment.followUpStatus = dto.followUpStatus;
    if (dto.notes !== undefined) appointment.notes = dto.notes.trim() || null;
    const wasRescheduled = startsAt.getTime() !== previousStartsAt.getTime();
    if (wasRescheduled) {
      appointment.status = 'scheduled';
      appointment.confirmationStatus = 'pending';
      appointment.confirmationTaskCreatedAt = new Date();
      appointment.reminderStatus = 'scheduled';
      appointment.reminderSentAt = null;
    }
    if (['completed', 'cancelled', 'no_show'].includes(appointment.status)) {
      appointment.followUpStatus = dto.followUpStatus || (appointment.followUpStatus === 'completed' ? 'completed' : 'due');
      appointment.reminderStatus = 'cancelled';
    }
    const saved = await this.appointments.save(appointment);
    if (['completed', 'cancelled', 'no_show'].includes(saved.status)) {
      saved.lead.nextFollowUpAt = new Date();
      saved.lead.recommendedNextAction =
        saved.status === 'completed'
          ? 'Record the appointment outcome and next milestone.'
          : 'Contact the lead and agree on the next step.';
      await this.leads.save(saved.lead);
    }
    await this.events.save(
      this.events.create({
        lead: saved.lead,
        eventType: 'appointment_updated',
        metadata: { appointmentId: saved.id, status: saved.status },
      }),
    );
    if (saved.status !== previousStatus || wasRescheduled) {
      const cancelled = saved.status === 'cancelled';
      await this.notifications.createForTenant({
        tenantId: saved.tenantId,
        assignedUserId: saved.assignedUserId,
        eventType: cancelled ? 'appointment.cancelled' : wasRescheduled ? 'appointment.rescheduled' : 'appointment.updated',
        category: 'leads',
        severity: cancelled ? 'warning' : 'success',
        title: cancelled
          ? `Appointment with ${saved.lead.fullName} was cancelled`
          : wasRescheduled
            ? `Appointment with ${saved.lead.fullName} was rescheduled`
          : `Appointment with ${saved.lead.fullName} is ${saved.status}`,
        message: cancelled
          ? 'Open the lead to agree on the next step.'
          : 'The appointment record and Today view have been updated.',
        deduplicationKey: wasRescheduled ? `appointment-rescheduled:${saved.id}:${saved.startsAt.toISOString()}` : `appointment-status:${saved.id}:${saved.status}`,
        actionUrl: `/app/appointments?appointmentId=${saved.id}`,
        entityType: 'appointment',
        entityId: saved.id,
      });
    }
    return saved;
  }

  async processInboundReply(lead: Lead, body: string, messageId: string) {
    const text = String(body || '').trim();
    if (!text) return { lead, handoff: null, classification: 'unchanged' as const };
    const lower = text.toLowerCase();
    const current = { ...(lead.qualificationData || {}) };
    const creditBlocker = /\bcredit\b|credit score|repair my credit|credit improvement/i.test(text);
    const sellerIntent = /\b(sell|selling|list my|listing my)\b/i.test(text);
    const buyerIntent = /\b(buy|buying|purchase|home search|house hunting)\b/i.test(text);
    const explicitlyNotPreapproved = /not (?:yet )?pre[- ]?approved|haven't been pre[- ]?approved/i.test(lower);
    const preapproved = !explicitlyNotPreapproved && /pre[- ]?approved|approval letter/i.test(lower);
    const wantsHuman = /\b(call me|give me a call|can we (?:talk|speak)|(?:would|i'd) like to (?:talk|speak)|speak with|talk to|appointment|meet)\b/i.test(lower);
    const timeframeDays = extractTimeframeDays(lower);
    const budget = extractBudget(text);

    if (sellerIntent) lead.leadType = 'seller';
    else if (buyerIntent) lead.leadType = 'buyer';
    if (preapproved) lead.preapproved = 'yes';
    if (explicitlyNotPreapproved) lead.preapproved = 'no';
    if (timeframeDays) lead.timeline = `Within ${timeframeDays} days`;
    if (budget) {
      if (lead.leadType === 'seller') lead.estimatedPrice = budget;
      else lead.budgetRange = budget;
    }
    current.intent = lead.leadType;
    current.preapproved = lead.preapproved || null;
    current.purchaseTimeframe = lead.timeline || null;
    current.budget = lead.leadType === 'seller'
      ? lead.estimatedPrice || null
      : lead.budgetRange || null;
    current.creditObstacle = creditBlocker;
    lead.qualificationData = current;
    lead.lastActivityAt = new Date();
    lead.stage = lead.stage === 'new' ? 'contacted' : lead.stage;

    let shouldHandoff = false;
    if (creditBlocker) {
      lead.temperature = 'warm';
      lead.temperatureReason = 'Interested in buying, but credit readiness needs improvement first.';
      lead.readinessLevel = 'exploring';
      lead.mainBlocker = 'Credit improvement';
      lead.nextMilestone = 'Improve credit readiness';
      lead.recommendedNextAction = 'Send a helpful check-in after the credit-improvement period.';
      lead.followUpCadence = 'Monthly';
      lead.nextFollowUpAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      lead.stage = 'nurture';
      lead.conversationSummary = `${lead.fullName} wants to buy but needs time to improve credit before moving forward.`;
      lead.recommendedTalkingPoints = [
        'Ask what credit milestone they are working toward.',
        'Offer a low-pressure check-in next month.',
      ];
    } else if (
      lead.leadType === 'seller' &&
      timeframeDays !== null &&
      timeframeDays <= 90 &&
      wantsHuman
    ) {
      lead.temperature = 'hot';
      lead.temperatureReason = `Seller planning to move within ${timeframeDays} days and requesting a conversation.`;
      lead.readinessLevel = timeframeDays <= 30 ? 'urgent' : 'ready';
      lead.mainBlocker = null;
      lead.nextMilestone = 'Discuss the property, timing, and listing approach';
      lead.recommendedNextAction = 'Call the seller today to schedule a listing consultation.';
      lead.followUpCadence = 'Personal follow-up now';
      lead.nextFollowUpAt = new Date();
      lead.stage = 'qualified';
      lead.conversationSummary = `${lead.fullName} plans to sell within ${timeframeDays} days${budget ? ` and mentioned ${budget}` : ''}.`;
      lead.recommendedTalkingPoints = [
        'Confirm the property address and condition.',
        'Ask why they are selling and whether they are interviewing other agents.',
        'Agree on a listing consultation time.',
      ];
      shouldHandoff = true;
    } else if (preapproved && timeframeDays !== null && timeframeDays <= 90) {
      lead.temperature = 'hot';
      lead.temperatureReason = `Pre-approved ${lead.leadType} planning to move within ${timeframeDays} days.`;
      lead.readinessLevel = timeframeDays <= 30 ? 'urgent' : 'ready';
      lead.mainBlocker = null;
      lead.nextMilestone = 'Speak with the agent and confirm search priorities';
      lead.recommendedNextAction = wantsHuman
        ? 'Call the lead at the requested time.'
        : 'Call the lead today to confirm needs and availability.';
      lead.followUpCadence = 'Personal follow-up now';
      lead.nextFollowUpAt = new Date();
      lead.stage = 'qualified';
      lead.conversationSummary = `${lead.fullName} is pre-approved${budget ? ` around ${budget}` : ''} and plans to move within ${timeframeDays} days.`;
      lead.recommendedTalkingPoints = [
        'Confirm preferred areas and property type.',
        'Confirm showing or consultation availability.',
        'Agree on the immediate next step.',
      ];
      shouldHandoff = true;
    } else {
      lead.temperatureReason =
        lead.temperatureReason || 'The lead replied and qualification is still in progress.';
      lead.readinessLevel = lead.readinessLevel || 'exploring';
      lead.recommendedNextAction = wantsHuman
        ? 'Respond personally and agree on the next step.'
        : lead.recommendedNextAction || 'Continue the qualification conversation.';
      lead.conversationSummary = `${lead.fullName} replied. Qualification is still in progress.`;
      shouldHandoff = wantsHuman;
    }

    await this.leads.save(lead);
    await this.events.save(
      this.events.create({
        lead,
        eventType: 'lead_qualification_updated',
        metadata: {
          messageId,
          temperature: lead.temperature,
          temperatureReason: lead.temperatureReason,
          readiness: lead.readinessLevel,
          blocker: lead.mainBlocker || null,
        },
      }),
    );

    await this.notifications.createForTenant({
      tenantId: lead.tenantId,
      assignedUserId: lead.assignedToUserId,
      eventType: 'lead.replied',
      category: 'leads',
      severity: shouldHandoff ? 'success' : 'info',
      title: `${lead.fullName} replied`,
      message: shouldHandoff
        ? lead.recommendedNextAction || 'A personal follow-up is ready.'
        : 'RealtyTechAI saved the reply and updated the lead record.',
      deduplicationKey: `lead-reply:${messageId}`,
      actionUrl: `/app/inbox?leadId=${lead.id}`,
      entityType: 'lead',
      entityId: lead.id,
    });

    const handoff = shouldHandoff
      ? await this.createHandoff(lead, text, {
          priority: lead.readinessLevel === 'urgent' ? 'urgent' : 'high',
          reason: lead.temperatureReason,
          recommendedAction: lead.recommendedNextAction || 'Call the lead today.',
        })
      : null;
    return { lead, handoff, classification: lead.temperature };
  }

  async createHandoff(
    lead: Lead,
    latestContext: string,
    input: { priority: LeadHandoff['priority']; reason: string; recommendedAction: string },
  ) {
    let handoff = await this.handoffs.findOne({
      where: [
        { leadId: lead.id, status: 'open' },
        { leadId: lead.id, status: 'opened' },
        { leadId: lead.id, status: 'snoozed' },
      ],
    });
    if (!handoff) {
      handoff = this.handoffs.create({
        tenantId: lead.tenantId,
        leadId: lead.id,
        assignedUserId: lead.assignedToUserId || null,
        status: 'open',
        priority: input.priority,
        reason: input.reason,
        summary: lead.conversationSummary || `${lead.fullName} is ready for personal follow-up.`,
        recommendedAction: input.recommendedAction,
        latestContext: latestContext.slice(0, 2000),
        dueAt: new Date(Date.now() + 15 * 60 * 1000),
      });
    } else {
      handoff.status = 'open';
      handoff.priority = input.priority;
      handoff.reason = input.reason;
      handoff.summary = lead.conversationSummary || handoff.summary;
      handoff.recommendedAction = input.recommendedAction;
      handoff.latestContext = latestContext.slice(0, 2000);
      handoff.snoozedUntil = null;
      handoff.dueAt = new Date(Date.now() + 15 * 60 * 1000);
    }
    const saved = await this.handoffs.save(handoff);
    await this.notifications.createForTenant({
      tenantId: lead.tenantId,
      assignedUserId: lead.assignedToUserId,
      eventType: 'handoff.created',
      category: 'tasks',
      severity: input.priority === 'urgent' ? 'critical' : 'warning',
      title: `${lead.fullName} needs you`,
      message: input.recommendedAction,
      deduplicationKey: `handoff:${saved.id}:active`,
      actionUrl: `/app/dashboard?leadId=${lead.id}`,
      entityType: 'handoff',
      entityId: saved.id,
    });
    return saved;
  }

  async requestHandoff(
    tenantId: string,
    leadId: string,
    reason?: string,
    ctx?: AccessContext,
  ) {
    const lead = await this.requireLeadAccess(tenantId, leadId, ctx);
    const clearReason = String(reason || '').trim() || 'A personal conversation is needed before follow-up continues.';
    lead.recommendedNextAction = 'Review the conversation and contact the lead personally.';
    lead.temperatureReason = lead.temperatureReason || clearReason;
    await this.leads.save(lead);
    return this.createHandoff(lead, lead.conversationSummary || clearReason, {
      priority: lead.temperature === 'hot' ? 'urgent' : 'high',
      reason: clearReason,
      recommendedAction: lead.recommendedNextAction,
    });
  }

  async listHandoffsForAdmin(filters: { tenantId?: string; status?: string; take?: number }) {
    const query = this.handoffs
      .createQueryBuilder('handoff')
      .leftJoinAndSelect('handoff.tenant', 'tenant')
      .leftJoinAndSelect('handoff.lead', 'lead')
      .leftJoinAndSelect('handoff.assignedUser', 'assignedUser')
      .orderBy('handoff.createdAt', 'DESC')
      .take(Math.min(Math.max(filters.take || 100, 1), 200));
    if (filters.tenantId) query.where('handoff.tenantId = :tenantId', { tenantId: filters.tenantId });
    if (filters.status && ['open', 'opened', 'snoozed', 'completed'].includes(filters.status)) {
      query.andWhere('handoff.status = :status', { status: filters.status });
    }
    return query.getMany();
  }

  async listAppointmentsForAdmin(filters: { tenantId?: string; status?: string; take?: number }) {
    const query = this.appointments
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.tenant', 'tenant')
      .leftJoinAndSelect('appointment.lead', 'lead')
      .leftJoinAndSelect('appointment.assignedUser', 'assignedUser')
      .orderBy('appointment.startsAt', 'DESC')
      .take(Math.min(Math.max(filters.take || 100, 1), 200));
    if (filters.tenantId) query.where('appointment.tenantId = :tenantId', { tenantId: filters.tenantId });
    if (filters.status && ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'].includes(filters.status)) {
      query.andWhere('appointment.status = :status', { status: filters.status });
    }
    return query.getMany();
  }

  async escalateOverdueHandoffs() {
    const overdueBefore = new Date(Date.now() - 15 * 60 * 1000);
    const rows = await this.handoffs
      .createQueryBuilder('handoff')
      .leftJoinAndSelect('handoff.lead', 'lead')
      .leftJoinAndSelect('handoff.tenant', 'tenant')
      .where('handoff.status IN (:...statuses)', { statuses: ['open', 'opened'] })
      .andWhere('handoff.priority IN (:...priorities)', { priorities: ['high', 'urgent'] })
      .andWhere('handoff.dueAt < :overdueBefore', { overdueBefore })
      .andWhere('handoff.adminEscalatedAt IS NULL')
      .take(50)
      .getMany();
    for (const handoff of rows) {
      await this.notifications.createForPlatform({
        eventType: 'handoff.overdue',
        category: 'tasks',
        severity: handoff.priority === 'urgent' ? 'critical' : 'warning',
        title: 'Client handoff is overdue',
        message: `${handoff.tenant?.name || 'A client'} has not completed the handoff for ${handoff.lead?.fullName || 'a lead'}.`,
        deduplicationKey: `handoff-overdue:${handoff.id}`,
        actionUrl: '/admin/dashboard?view=handoffs',
        entityType: 'handoff',
        entityId: handoff.id,
      });
      handoff.adminEscalatedAt = new Date();
      await this.handoffs.save(handoff);
    }
    return { escalated: rows.length };
  }

  private async runOperationalChecks() {
    await Promise.all([
      this.escalateOverdueHandoffs(),
      this.notifyDueClientActions(),
    ]);
  }

  async notifyDueClientActions() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dueLeads = await this.leads
      .createQueryBuilder('lead')
      .innerJoin('lead.tenant', 'tenant')
      .where('lead.nextFollowUpAt BETWEEN :dayAgo AND :now', { dayAgo, now })
      .andWhere('lead.stage NOT IN (:...finished)', { finished: ['closed', 'lost'] })
      .andWhere('tenant.lifecycleStatus = :activeLifecycle', {
        activeLifecycle: 'ACTIVE',
      })
      .take(100)
      .getMany();
    const appointments = await this.appointments
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.lead', 'lead')
      .innerJoin('appointment.tenant', 'tenant')
      .where('appointment.startsAt BETWEEN :now AND :tomorrow', { now, tomorrow })
      .andWhere('appointment.status IN (:...appointmentStatuses)', {
        appointmentStatuses: ['scheduled', 'confirmed'],
      })
      .andWhere('appointment.reminderStatus = :reminderStatus', {
        reminderStatus: 'scheduled',
      })
      .andWhere('lead.stage NOT IN (:...finishedStages)', {
        finishedStages: ['closed', 'lost'],
      })
      .andWhere('tenant.lifecycleStatus = :activeLifecycle', {
        activeLifecycle: 'ACTIVE',
      })
      .take(100)
      .getMany();
    const dayKey = now.toISOString().slice(0, 10);
    for (const lead of dueLeads) {
      await this.notifications.createForTenant({
        tenantId: lead.tenantId,
        assignedUserId: lead.assignedToUserId,
        eventType: 'follow_up.due',
        category: 'tasks',
        severity: lead.temperature === 'hot' ? 'warning' : 'info',
        title: `Follow-up due with ${lead.fullName}`,
        message: lead.recommendedNextAction || 'Open RealtyTechAI to review the next step.',
        deduplicationKey: `follow-up-due:${lead.id}:${dayKey}`,
        actionUrl: `/app/dashboard?leadId=${lead.id}`,
        entityType: 'lead',
        entityId: lead.id,
      });
    }
    for (const appointment of appointments) {
      await this.notifications.createForTenant({
        tenantId: appointment.tenantId,
        assignedUserId: appointment.assignedUserId,
        eventType: 'appointment.reminder_due',
        category: 'tasks',
        severity: 'warning',
        title: `Confirm the appointment with ${appointment.lead.fullName}`,
        message: 'The appointment is within 24 hours and still needs confirmation.',
        deduplicationKey: `appointment-reminder:${appointment.id}:${appointment.startsAt.toISOString()}`,
        actionUrl: `/app/appointments?appointmentId=${appointment.id}`,
        entityType: 'appointment',
        entityId: appointment.id,
      });
      appointment.reminderStatus = 'sent';
      appointment.reminderSentAt = new Date();
      await this.appointments.save(appointment);
    }
    return { followUps: dueLeads.length, appointments: appointments.length };
  }

  private async requireLeadAccess(tenantId: string, leadId: string, ctx?: AccessContext) {
    const lead = await this.leads.findOne({ where: { id: leadId, tenantId } });
    if (!lead) throw new NotFoundException('Lead not found');
    if (!this.canSeeAll(ctx) && lead.assignedToUserId !== ctx?.userId) {
      throw new ForbiddenException('Lead is not assigned to this user');
    }
    return lead;
  }
}

function extractTimeframeDays(text: string): number | null {
  const days = text.match(/(?:within|next|in)\s+(\d{1,3})\s*days?/i);
  if (days) return Math.max(1, Number(days[1]));
  const months = text.match(/(?:within|next|in)\s+(\d{1,2})\s*months?/i);
  if (months) return Math.max(1, Number(months[1]) * 30);
  if (/\b(two|a couple of) months?\b/i.test(text)) return 60;
  if (/\b(one|a) month\b/i.test(text)) return 30;
  if (/\bthree months?\b/i.test(text)) return 90;
  return null;
}

function extractBudget(text: string): string | null {
  const dollars = text.match(/\$\s?([0-9][0-9,]*(?:\.\d+)?)\s*([kKmM])?/);
  if (!dollars) return null;
  const amount = Number(dollars[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  const multiplier = dollars[2]?.toLowerCase() === 'm' ? 1_000_000 : dollars[2]?.toLowerCase() === 'k' ? 1_000 : 1;
  const total = Math.round(amount * multiplier);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(total);
}
