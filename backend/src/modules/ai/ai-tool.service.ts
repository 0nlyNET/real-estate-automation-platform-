import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isSafeBookingUrl } from '../../common/booking-link';
import { EntitlementService } from '../entitlements/entitlement.service';
import { ComplianceService } from '../compliance/compliance.service';
import { ClientOperationsService } from '../client-operations/client-operations.service';
import { Appointment } from '../client-operations/appointment.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { AiRun } from './ai-run.entity';
import { AI_TOOL_NAMES, AiToolName, AiToolRequest } from './ai.types';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { ConversationAiState } from './conversation-ai-state.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';
import { PlatformAiControl } from './platform-ai-control.entity';
import { CrmEventsService } from '../crm-events/crm-events.service';

export type AiToolContext = {
  run: AiRun;
  lead: Lead;
  triggeringMessage: Message | null;
  settings: WorkspaceAiSettings;
  knowledge: BrokerageKnowledge;
  state: ConversationAiState;
  channel: 'sms' | 'email';
};

export type AiToolResult = {
  name: AiToolName;
  status: 'executed' | 'blocked';
  idempotencyKey: string;
  output?: Record<string, unknown>;
  code?: string;
  reason?: string;
};

const QUALIFICATION_FIELDS = new Set([
  'intent',
  'location',
  'timeline',
  'budget',
  'preapproval',
  'preferredContact',
  'preferredTimes',
]);

function parseArguments(request: AiToolRequest): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.arguments || '{}');
  } catch {
    throw new BadRequestException('Tool arguments must be valid JSON');
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new BadRequestException('Tool arguments must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function stringValue(value: unknown, max = 2_000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function objectValue(value: unknown) {
  return value && !Array.isArray(value) && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

@Injectable()
export class AiToolService {
  constructor(
    @InjectRepository(Lead)
    private readonly leads: Repository<Lead>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(ConversationAiState)
    private readonly states: Repository<ConversationAiState>,
    @InjectRepository(WorkspaceAiSettings)
    private readonly aiSettings: Repository<WorkspaceAiSettings>,
    @InjectRepository(BrokerageKnowledge)
    private readonly knowledge: Repository<BrokerageKnowledge>,
    @InjectRepository(TenantSettings)
    private readonly tenantSettings: Repository<TenantSettings>,
    @InjectRepository(PlatformAiControl)
    private readonly platformControl: Repository<PlatformAiControl>,
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    private readonly compliance: ComplianceService,
    private readonly entitlements: EntitlementService,
    private readonly clientOperations: ClientOperationsService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly crmEvents?: CrmEventsService,
  ) {}

  async execute(
    context: AiToolContext,
    request: AiToolRequest,
    index: number,
  ): Promise<AiToolResult> {
    const idempotencyKey = `ai-tool:${context.run.id}:${index}`;
    if (!AI_TOOL_NAMES.includes(request.name)) {
      return {
        name: request.name,
        status: 'blocked',
        idempotencyKey,
        code: 'TOOL_NOT_ALLOWLISTED',
        reason: 'The requested tool is not allowlisted.',
      };
    }
    const safetyTool = [
      'create_human_handoff',
      'pause_ai_for_lead',
      'notify_assigned_agent',
    ].includes(request.name);
    try {
      const args = parseArguments(request);
      await this.validateContext(context, safetyTool);
      const output = await this.runTool(context, request.name, args, idempotencyKey);
      return {
        name: request.name,
        status: 'executed',
        idempotencyKey,
        output,
      };
    } catch (error: any) {
      return {
        name: request.name,
        status: 'blocked',
        idempotencyKey,
        code: String(error?.response?.code || error?.code || 'TOOL_VALIDATION_FAILED'),
        reason: String(
          error?.response?.message ||
            error?.message ||
            'The requested tool did not pass validation',
        ).slice(0, 500),
      };
    }
  }

  private async validateContext(context: AiToolContext, safetyTool: boolean) {
    const [lead, state, settings, control, trigger] = await Promise.all([
      this.leads.findOne({
        where: { id: context.lead.id, tenantId: context.run.tenantId },
      }),
      this.states.findOne({
        where: { leadId: context.lead.id, tenantId: context.run.tenantId },
      }),
      this.aiSettings.findOne({ where: { tenantId: context.run.tenantId } }),
      this.platformControl.findOne({ where: { id: 'global' } }),
      context.triggeringMessage
        ? this.messages.findOne({
            where: {
              id: context.triggeringMessage.id,
              leadId: context.lead.id,
              direction: 'inbound',
            },
          })
        : Promise.resolve(null),
    ]);
    if (!lead || !state || !settings || (context.triggeringMessage && !trigger)) {
      throw new ForbiddenException({
        code: 'TENANT_CONTEXT_INVALID',
        message: 'The AI tool context is no longer valid.',
      });
    }
    if (control?.paused && !safetyTool) {
      throw new ForbiddenException({
        code: 'PLATFORM_AI_PAUSED',
        message: 'Platform AI is paused.',
      });
    }
    if (state.ownershipStatus !== 'ai_handling' && !safetyTool) {
      throw new ForbiddenException({
        code: 'CONVERSATION_NOT_AI_CONTROLLED',
        message: 'The conversation is not controlled by AI.',
      });
    }
    if ((!settings.aiEnabled || settings.aiPaused) && !safetyTool) {
      throw new ForbiddenException({
        code: 'WORKSPACE_AI_PAUSED',
        message: 'Workspace AI is paused.',
      });
    }
    if (!safetyTool) {
      const action =
        context.channel === 'sms'
          ? 'send_automated_sms'
          : 'send_automated_email';
      const entitlement = await this.entitlements.evaluate(
        context.run.tenantId,
        action,
      );
      if (!entitlement.allowed) {
        throw new ForbiddenException({
          code: 'SERVICE_NOT_ENTITLED',
          message: entitlement.reasons.join('; '),
        });
      }
      const consent = await this.compliance.communicationEligibility(
        context.run.tenantId,
        lead,
        context.channel,
      );
      if (!consent.allowed) {
        throw new ForbiddenException({
          code: consent.code || 'MISSING_CONSENT',
          message: consent.reason || 'Consent is not valid.',
        });
      }
    }
  }

  private async runTool(
    context: AiToolContext,
    name: AiToolName,
    args: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<Record<string, unknown>> {
    if (name === 'get_lead_context') {
      return {
        id: context.lead.id,
        fullName: context.lead.fullName,
        leadType: context.lead.leadType,
        location: context.lead.location || null,
        timeline: context.lead.timeline || null,
        budget:
          context.lead.budgetRange || context.lead.estimatedPrice || null,
        preapproved: context.lead.preapproved || null,
        temperature: context.lead.temperature,
        qualificationData: context.lead.qualificationData || {},
      };
    }
    if (name === 'get_conversation_history') {
      const rows = await this.messages.find({
        where: { leadId: context.lead.id },
        order: { createdAt: 'DESC' },
        take: 20,
      });
      return {
        messages: rows.reverse().map((message) => ({
          direction: message.direction,
          channel: message.channel,
          body: message.body.slice(0, 2_000),
          authorship: message.authorship,
          createdAt: message.createdAt,
        })),
      };
    }
    if (name === 'get_verified_business_information') {
      const approved = await this.knowledge.findOne({
        where: {
          tenantId: context.run.tenantId,
          approvalStatus: 'approved',
        },
      });
      if (!approved) {
        throw new ForbiddenException({
          code: 'KNOWLEDGE_NOT_APPROVED',
          message: 'Approved brokerage information is unavailable.',
        });
      }
      return {
        publicName: approved.publicName || null,
        officeEmail: approved.officeEmail || null,
        officePhone: approved.officePhone || null,
        serviceAreas: approved.serviceAreas || [],
        businessHours: approved.businessHours || {},
        schedulingInstructions: approved.schedulingInstructions || null,
        approvedFaqs: approved.approvedFaqs || [],
        escalationInstructions: approved.escalationInstructions || null,
        qualificationQuestions: approved.qualificationQuestions || [],
        prohibitedTopics: approved.prohibitedTopics || [],
        agentRoster: approved.agentRoster || [],
        routingRules: approved.routingRules || {},
        requiredDisclaimer: approved.requiredDisclaimer || null,
      };
    }
    if (name === 'update_lead_qualification') {
      const qualification = objectValue(args.qualification);
      if (!qualification) {
        throw new BadRequestException('qualification must be an object');
      }
      const invalid = Object.keys(qualification).filter(
        (key) => !QUALIFICATION_FIELDS.has(key),
      );
      if (invalid.length) {
        throw new BadRequestException(
          `Unsupported qualification field: ${invalid[0]}`,
        );
      }
      for (const [key, value] of Object.entries(qualification)) {
        if (value !== null && typeof value !== 'string') {
          throw new BadRequestException(
            `Qualification field ${key} must be text or null`,
          );
        }
        if (typeof value === 'string' && value.length > 500) {
          throw new BadRequestException(
            `Qualification field ${key} is too long`,
          );
        }
      }
      const conflicts = [
        ['intent', context.lead.leadType],
        ['location', context.lead.location],
        ['preapproval', context.lead.preapproved],
      ].filter(([key, current]) => {
        const proposed = stringValue(qualification[key as string], 500)
          .toLowerCase();
        return (
          proposed &&
          current &&
          String(current).trim().toLowerCase() !== proposed
        );
      });
      if (conflicts.length) {
        throw new ForbiddenException({
          code: 'CONFLICTING_LEAD_INFORMATION',
          message:
            'New qualification information conflicts with the existing lead record.',
        });
      }
      const merged = {
        ...(context.lead.qualificationData || {}),
        ...qualification,
      };
      context.lead.qualificationData = merged as Record<
        string,
        string | boolean | number | null
      >;
      const intent = stringValue(qualification.intent, 20).toLowerCase();
      if (['buyer', 'seller', 'renter', 'investor'].includes(intent)) {
        context.lead.leadType = intent as Lead['leadType'];
      }
      if (stringValue(qualification.location, 255)) {
        context.lead.location = stringValue(qualification.location, 255);
      }
      if (stringValue(qualification.timeline, 120)) {
        context.lead.timeline = stringValue(qualification.timeline, 120);
      }
      if (stringValue(qualification.budget, 120)) {
        if (context.lead.leadType === 'seller') {
          context.lead.estimatedPrice = stringValue(
            qualification.budget,
            120,
          );
        } else {
          context.lead.budgetRange = stringValue(qualification.budget, 120);
        }
      }
      const preapproval = stringValue(
        qualification.preapproval,
        20,
      ).toLowerCase();
      if (['yes', 'no', 'unsure'].includes(preapproval)) {
        context.lead.preapproved = preapproval as Lead['preapproved'];
      }
      await this.leads.save(context.lead);
      return { updatedFields: Object.keys(qualification) };
    }
    if (name === 'update_conversation_summary') {
      const summary = stringValue(args.summary, 2_000);
      if (!summary) throw new BadRequestException('summary is required');
      context.lead.conversationSummary = summary;
      await this.leads.save(context.lead);
      await this.crmEvents?.publish(context.run.tenantId, 'conversation.summary_ready', {
        leadId: context.lead.id,
        summary,
        aiRunId: context.run.id,
      });
      return { saved: true };
    }
    if (name === 'set_lead_temperature') {
      const temperature = stringValue(args.temperature, 20).toLowerCase();
      if (!['hot', 'warm', 'cold'].includes(temperature)) {
        throw new BadRequestException('temperature is invalid');
      }
      const reason = stringValue(args.reason, 1_000);
      if (!reason) throw new BadRequestException('temperature reason is required');
      context.lead.temperature = temperature as Lead['temperature'];
      context.lead.temperatureReason = reason;
      await this.leads.save(context.lead);
      return { temperature };
    }
    if (name === 'set_next_action') {
      const nextAction = stringValue(args.nextAction, 255);
      if (!nextAction) throw new BadRequestException('nextAction is required');
      context.lead.recommendedNextAction = nextAction;
      await this.leads.save(context.lead);
      return { nextAction };
    }
    if (name === 'send_verified_booking_link') {
      if ((context.settings.bookingBehavior || 'verified_link_only') !== 'verified_link_only') {
        throw new BadRequestException('AI booking is configured for human handoff or disabled');
      }
      const settings = await this.tenantSettings.findOne({
        where: { tenantId: context.run.tenantId },
      });
      const link = String(settings?.bookingLink || '').trim();
      if (
        !settings?.bookingLinkVerifiedAt ||
        !isSafeBookingUrl(link)
      ) {
        throw new ForbiddenException({
          code: 'BOOKING_LINK_NOT_VERIFIED',
          message: 'The workspace booking link is not verified.',
        });
      }
      return { bookingLink: link };
    }
    if (name === 'create_or_update_appointment') {
      if ((context.settings.bookingBehavior || 'verified_link_only') !== 'calendar_booking') {
        throw new BadRequestException(
          'Direct AI booking requires a tested Google Calendar connection and calendar booking mode.',
        );
      }
      const appointmentId = stringValue(args.appointmentId, 80);
      const requestedStart = stringValue(args.startsAt, 80);
      const requestedEnd = stringValue(args.endsAt, 80);
      if (requestedStart && !/(?:Z|[+-]\d{2}:\d{2})$/.test(requestedStart)) {
        throw new BadRequestException(
          'AI appointment times must include an explicit UTC offset.',
        );
      }
      if (requestedEnd && !/(?:Z|[+-]\d{2}:\d{2})$/.test(requestedEnd)) {
        throw new BadRequestException(
          'AI appointment times must include an explicit UTC offset.',
        );
      }
      if (appointmentId) {
        const appointment = await this.appointments.findOne({
          where: {
            id: appointmentId,
            tenantId: context.run.tenantId,
            leadId: context.lead.id,
          },
        });
        if (!appointment) {
          throw new ForbiddenException({
            code: 'APPOINTMENT_CONTEXT_INVALID',
            message: 'The appointment does not belong to this lead conversation.',
          });
        }
        const updated = await this.clientOperations.updateAppointment(
          appointmentId,
          context.run.tenantId,
          {
            startsAt: requestedStart || undefined,
            endsAt: requestedEnd || undefined,
            notes:
              args.notes === undefined
                ? undefined
                : stringValue(args.notes, 2_000),
          },
        );
        return { appointmentId: updated.id, updated: true };
      }
      const startsAt = new Date(requestedStart);
      if (
        Number.isNaN(startsAt.getTime()) ||
        startsAt <= new Date() ||
        startsAt.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1000
      ) {
        throw new BadRequestException(
          'Appointment start must be within the next 90 days.',
        );
      }
      const created = await this.clientOperations.createAppointment(
        context.run.tenantId,
        {
          leadId: context.lead.id,
          startsAt: startsAt.toISOString(),
          endsAt: requestedEnd || undefined,
          notes: stringValue(args.notes, 2_000) || undefined,
          idempotencyKey,
        },
        undefined,
        'conversation',
      );
      return { appointmentId: created.id, created: true };
    }
    if (name === 'create_human_handoff') {
      const reason =
        stringValue(args.reason, 1_000) ||
        'The AI requested personal follow-up.';
      const nextAction =
        stringValue(args.nextAction, 255) ||
        'Review the conversation and contact the lead.';
      const priority = stringValue(args.priority, 20);
      const saved = await this.clientOperations.createHandoff(
        context.lead,
        context.triggeringMessage?.body || context.lead.notes || 'Initial lead intake',
        {
          priority: ['normal', 'high', 'urgent'].includes(priority)
            ? (priority as 'normal' | 'high' | 'urgent')
            : 'high',
          reason,
          recommendedAction: nextAction,
        },
      );
      context.state.ownershipStatus = 'waiting_for_human';
      context.state.escalationReason = reason;
      await this.states.save(context.state);
      return { handoffId: saved.id };
    }
    if (name === 'pause_ai_for_lead') {
      const reason =
        stringValue(args.reason, 1_000) || 'AI paused by a validated tool action.';
      context.state.ownershipStatus = 'paused';
      context.state.aiPausedReason = reason;
      await this.states.save(context.state);
      return { paused: true };
    }
    if (name === 'notify_assigned_agent') {
      const reason =
        stringValue(args.reason, 1_000) ||
        'The conversation needs attention.';
      await this.notifications.createForTenant({
        tenantId: context.run.tenantId,
        assignedUserId: context.lead.assignedToUserId,
        eventType: 'ai.agent_attention',
        category: 'leads',
        severity: 'warning',
        title: `${context.lead.fullName} needs attention`,
        message: reason,
        deduplicationKey: idempotencyKey,
        actionUrl: `/app/inbox?leadId=${context.lead.id}`,
        entityType: 'lead',
        entityId: context.lead.id,
      });
      return { notified: true };
    }
    throw new ForbiddenException('Tool is not implemented');
  }
}
