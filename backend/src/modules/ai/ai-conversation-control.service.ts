import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { ConversationLockService } from '../../common/conversation-lock.service';
import { hasAtLeastRole, UserRole } from '../../common/rbac';
import { AuditService } from '../audit/audit.service';
import { LeadHandoff } from '../client-operations/lead-handoff.entity';
import { ClientOperationsService } from '../client-operations/client-operations.service';
import { ComplianceService } from '../compliance/compliance.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SequencesService } from '../sequences/sequences.service';
import { Tenant } from '../tenants/tenant.entity';
import { AiRun } from './ai-run.entity';
import { AiAuditService } from './ai-audit.service';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import {
  ConversationAiState,
  ConversationOwnershipStatus,
} from './conversation-ai-state.entity';
import { PlatformAiControl } from './platform-ai-control.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';

export type ConversationActor = {
  userId?: string;
  email?: string | null;
  role?: UserRole;
};

const PENDING_AI_MESSAGE_STATUSES: Message['status'][] = [
  'draft',
  'created',
  'queued',
  'pending',
  'scheduled',
  'sending',
];

@Injectable()
export class AiConversationControlService {
  constructor(
    @InjectRepository(ConversationAiState)
    private readonly states: Repository<ConversationAiState>,
    @InjectRepository(WorkspaceAiSettings)
    private readonly settings: Repository<WorkspaceAiSettings>,
    @InjectRepository(BrokerageKnowledge)
    private readonly knowledge: Repository<BrokerageKnowledge>,
    @InjectRepository(PlatformAiControl)
    private readonly platformControls: Repository<PlatformAiControl>,
    @InjectRepository(AiRun)
    private readonly runs: Repository<AiRun>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(Lead)
    private readonly leads: Repository<Lead>,
    @InjectRepository(LeadHandoff)
    private readonly handoffs: Repository<LeadHandoff>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly locks: ConversationLockService,
    private readonly compliance: ComplianceService,
    private readonly entitlements: EntitlementService,
    private readonly sequences: SequencesService,
    private readonly clientOperations: ClientOperationsService,
    private readonly notifications: NotificationsService,
    private readonly aiAudit: AiAuditService,
    private readonly audit: AuditService,
  ) {}

  async getOrCreateState(
    tenantId: string,
    leadId: string,
    defaultStatus: ConversationOwnershipStatus = 'human_handling',
  ) {
    const existing = await this.states.findOne({ where: { tenantId, leadId } });
    if (existing) return existing;
    try {
      return await this.states.save(
        this.states.create({
          tenantId,
          leadId,
          ownershipStatus: defaultStatus,
          aiTurnCount: 0,
          usageUnits: 0,
        }),
      );
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      return this.states.findOneOrFail({ where: { tenantId, leadId } });
    }
  }

  async getConversation(
    tenantId: string,
    leadId: string,
    actor?: ConversationActor,
  ) {
    const lead = await this.requireLeadAccess(tenantId, leadId, actor);
    const settings = await this.getOrCreateSettings(tenantId);
    const state = await this.getOrCreateState(
      tenantId,
      leadId,
      settings.aiEnabled && settings.responseMode !== 'human_only'
        ? 'ai_handling'
        : 'human_handling',
    );
    const drafts = await this.messages.find({
      where: {
        leadId,
        authorship: 'ai',
        status: 'draft',
      },
      order: { createdAt: 'DESC' },
      take: 10,
    });
    return {
      leadId,
      ownershipStatus: state.ownershipStatus,
      aiTurnCount: state.aiTurnCount,
      aiPausedReason: state.aiPausedReason || null,
      escalationReason: state.escalationReason || null,
      takenOverByUserId: state.takenOverByUserId || null,
      takenOverAt: state.takenOverAt || null,
      returnedToAiAt: state.returnedToAiAt || null,
      aiGeneratedSummary: lead.conversationSummary || null,
      informationCollected: lead.qualificationData || {},
      recommendedNextAction: lead.recommendedNextAction || null,
      drafts: drafts.map((message) => ({
        id: message.id,
        body: message.body,
        channel: message.channel,
        createdAt: message.createdAt,
      })),
    };
  }

  async takeOver(
    tenantId: string,
    leadId: string,
    actor: ConversationActor,
    reason = 'An authorized team member took over the conversation.',
  ) {
    const lead = await this.requireLeadAccess(tenantId, leadId, actor);
    return this.locks.withLock(tenantId, leadId, async () => {
      const state = await this.getOrCreateState(tenantId, leadId);
      await this.cancelPendingAiMessages(leadId, 'HUMAN_TAKEOVER');
      await this.sequences.stopForLead(tenantId, leadId, 'manual');
      state.ownershipStatus = 'human_handling';
      state.takenOverByUserId = actor.userId || null;
      state.takenOverAt = new Date();
      state.returnedToAiAt = null;
      state.aiPausedReason = reason.slice(0, 1_000);
      const saved = await this.states.save(state);
      await this.clientOperations.createHandoff(lead, reason, {
        priority: 'high',
        reason,
        recommendedAction:
          'Review the conversation and continue personally from the inbox.',
      });
      await this.notifications.createForTenant({
        tenantId,
        assignedUserId: lead.assignedToUserId,
        eventType: 'ai.human_takeover',
        category: 'leads',
        severity: 'info',
        title: `${lead.fullName} is human-controlled`,
        message: 'A team member took over this conversation.',
        deduplicationKey: `ai-takeover:${saved.id}:${saved.version}`,
        actionUrl: `/app/inbox?leadId=${lead.id}`,
        entityType: 'lead',
        entityId: lead.id,
      });
      if (actor.userId) {
        await this.aiAudit.recordHuman({
          tenantId,
          actorId: actor.userId,
          actorEmail: actor.email,
          action: 'ai_conversation_takeover',
          leadId,
          metadata: { reason },
        });
      }
      return this.getConversation(tenantId, leadId, actor);
    });
  }

  async returnToAi(
    tenantId: string,
    leadId: string,
    actor: ConversationActor,
    confirmed: boolean,
  ) {
    if (!confirmed) {
      throw new ConflictException('Return to AI requires confirmation.');
    }
    const lead = await this.requireLeadAccess(tenantId, leadId, actor);
    return this.locks.withLock(tenantId, leadId, async () => {
      const [settings, knowledge, state, openHandoff, control, lastInbound] =
        await Promise.all([
          this.getOrCreateSettings(tenantId),
          this.knowledge.findOne({ where: { tenantId } }),
          this.getOrCreateState(tenantId, leadId),
          this.handoffs.findOne({
            where: {
              tenantId,
              leadId,
              status: In(['open', 'opened', 'snoozed']),
            },
          }),
          this.getPlatformControl(),
          this.messages.findOne({
            where: { leadId, direction: 'inbound' },
            order: { createdAt: 'DESC' },
          }),
        ]);
      if (control.paused) {
        throw new ConflictException('Platform AI is paused.');
      }
      if (
        !settings.aiEnabled ||
        settings.aiPaused ||
        settings.responseMode === 'human_only'
      ) {
        throw new ConflictException('Enable an approved AI mode first.');
      }
      if (
        settings.configurationApprovalStatus !== 'approved' ||
        knowledge?.approvalStatus !== 'approved' ||
        !settings.identityLabel?.trim()
      ) {
        throw new ConflictException(
          'AI settings and brokerage information must be approved first.',
        );
      }
      if (openHandoff) {
        throw new ConflictException(
          'Complete the unresolved human handoff before returning control to AI.',
        );
      }
      const channel = lastInbound?.channel || (lead.phone ? 'sms' : 'email');
      const consent = await this.compliance.communicationEligibility(
        tenantId,
        lead,
        channel,
      );
      if (!consent.allowed) {
        throw new ConflictException(consent.reason || 'Lead consent is not valid.');
      }
      const entitlement = await this.entitlements.evaluate(
        tenantId,
        channel === 'sms' ? 'send_automated_sms' : 'send_automated_email',
      );
      if (!entitlement.allowed) {
        throw new ConflictException(entitlement.reasons.join('; '));
      }
      if (!String(process.env.OPENAI_API_KEY || '').trim()) {
        throw new ConflictException('The AI provider is not configured.');
      }
      state.ownershipStatus = 'ai_handling';
      state.returnedToAiAt = new Date();
      state.takenOverByUserId = null;
      state.takenOverAt = null;
      state.aiPausedReason = null;
      state.escalationReason = null;
      state.aiTurnCount = 0;
      await this.states.save(state);
      if (actor.userId) {
        await this.aiAudit.recordHuman({
          tenantId,
          actorId: actor.userId,
          actorEmail: actor.email,
          action: 'ai_conversation_returned',
          leadId,
          metadata: { confirmed: true },
        });
      }
      return this.getConversation(tenantId, leadId, actor);
    });
  }

  async approveDraft(
    tenantId: string,
    leadId: string,
    messageId: string,
    actor: ConversationActor,
  ) {
    await this.requireLeadAccess(tenantId, leadId, actor);
    return this.locks.withLock(tenantId, leadId, async () => {
      const message = await this.requireDraft(leadId, messageId);
      const state = await this.getOrCreateState(tenantId, leadId);
      if (state.ownershipStatus !== 'ai_handling') {
        throw new ConflictException('Return the conversation to AI before approving its draft.');
      }
      message.status = 'queued';
      message.approvedByUserId = actor.userId || null;
      message.approvedAt = new Date();
      await this.messages.save(message);
      if (actor.userId) {
        await this.aiAudit.recordHuman({
          tenantId,
          actorId: actor.userId,
          actorEmail: actor.email,
          action: 'ai_draft_approved',
          leadId,
          metadata: { messageId },
        });
      }
      return { status: 'queued', messageId };
    });
  }

  async editAndSendDraft(
    tenantId: string,
    leadId: string,
    messageId: string,
    body: string,
    actor: ConversationActor,
  ) {
    await this.requireLeadAccess(tenantId, leadId, actor);
    const clean = String(body || '').trim();
    if (!clean || clean.length > 5_000) {
      throw new ConflictException('Edited message must contain 1–5,000 characters.');
    }
    return this.locks.withLock(tenantId, leadId, async () => {
      const message = await this.requireDraft(leadId, messageId);
      const state = await this.getOrCreateState(tenantId, leadId);
      message.body = clean;
      message.authorship = 'human';
      message.status = 'queued';
      message.approvedByUserId = actor.userId || null;
      message.approvedAt = new Date();
      message.editedAt = new Date();
      state.ownershipStatus = 'human_handling';
      state.takenOverByUserId = actor.userId || null;
      state.takenOverAt = new Date();
      state.aiPausedReason = 'A human edited and sent an AI draft.';
      await Promise.all([
        this.messages.save(message),
        this.states.save(state),
        this.cancelPendingAiMessages(leadId, 'HUMAN_EDITED_DRAFT', message.id),
      ]);
      await this.sequences.stopForLead(tenantId, leadId, 'manual');
      if (actor.userId) {
        await this.aiAudit.recordHuman({
          tenantId,
          actorId: actor.userId,
          actorEmail: actor.email,
          action: 'ai_draft_edited_and_sent',
          leadId,
          metadata: { messageId },
        });
      }
      return { status: 'queued', messageId, ownershipStatus: 'human_handling' };
    });
  }

  async rejectDraft(
    tenantId: string,
    leadId: string,
    messageId: string,
    actor: ConversationActor,
  ) {
    await this.requireLeadAccess(tenantId, leadId, actor);
    return this.locks.withLock(tenantId, leadId, async () => {
      const message = await this.requireDraft(leadId, messageId);
      message.status = 'canceled';
      message.canceledAt = new Date();
      message.errorCode = 'AI_DRAFT_REJECTED';
      message.sanitizedErrorMessage = 'AI draft rejected by an authorized user';
      await this.messages.save(message);
      if (actor.userId) {
        await this.aiAudit.recordHuman({
          tenantId,
          actorId: actor.userId,
          actorEmail: actor.email,
          action: 'ai_draft_rejected',
          leadId,
          metadata: { messageId },
        });
      }
      return { status: 'canceled', messageId };
    });
  }

  async runHumanSendExclusive<T>(
    tenantId: string,
    leadId: string,
    actor: ConversationActor | undefined,
    callback: () => Promise<T>,
  ): Promise<T> {
    return this.locks.withLock(tenantId, leadId, async () => {
      const state = await this.getOrCreateState(tenantId, leadId);
      await this.cancelPendingAiMessages(leadId, 'HUMAN_MESSAGE_SENT');
      state.ownershipStatus = 'human_handling';
      state.takenOverByUserId = actor?.userId || null;
      state.takenOverAt = new Date();
      state.returnedToAiAt = null;
      state.aiPausedReason = 'A human sent a manual message.';
      await this.states.save(state);
      await this.sequences.stopForLead(tenantId, leadId, 'manual');
      if (actor?.userId) {
        await this.aiAudit.recordHuman({
          tenantId,
          actorId: actor.userId,
          actorEmail: actor.email,
          action: 'ai_conversation_manual_message',
          leadId,
          metadata: { ownershipStatus: 'human_handling' },
        });
      }
      return callback();
    });
  }

  async runAiSendExclusive<T>(
    tenantId: string,
    leadId: string,
    messageId: string,
    callback: () => Promise<T>,
  ): Promise<{ allowed: true; result: T } | { allowed: false; reason: string }> {
    return this.locks.withLock(tenantId, leadId, async () => {
      const [state, message, settings, control] = await Promise.all([
        this.states.findOne({ where: { tenantId, leadId } }),
        this.messages.findOne({ where: { id: messageId, leadId } }),
        this.settings.findOne({ where: { tenantId } }),
        this.getPlatformControl(),
      ]);
      if (!state || state.ownershipStatus !== 'ai_handling') {
        return { allowed: false, reason: 'Conversation is not AI-controlled.' };
      }
      if (
        !message ||
        message.authorship !== 'ai' ||
        message.status === 'canceled'
      ) {
        return { allowed: false, reason: 'AI message is no longer sendable.' };
      }
      if (
        control.paused ||
        !settings?.aiEnabled ||
        settings.aiPaused ||
        settings.responseMode === 'human_only'
      ) {
        return { allowed: false, reason: 'AI sending is paused.' };
      }
      if (
        settings.responseMode === 'draft' &&
        (!message.approvedAt || !message.approvedByUserId)
      ) {
        return { allowed: false, reason: 'AI draft has not been approved.' };
      }
      const laterHuman = await this.messages
        .createQueryBuilder('message')
        .where('message.leadId = :leadId', { leadId })
        .andWhere('message.direction = :direction', { direction: 'outbound' })
        .andWhere('message.authorship = :authorship', { authorship: 'human' })
        .andWhere('message.createdAt > :createdAt', { createdAt: message.createdAt })
        .getOne();
      if (laterHuman) {
        return {
          allowed: false,
          reason: 'A human response was created after the AI response.',
        };
      }
      return { allowed: true, result: await callback() };
    });
  }

  async markWaitingForHuman(
    tenantId: string,
    leadId: string,
    reason: string,
    priority: 'normal' | 'high' | 'urgent' = 'high',
  ) {
    const lead = await this.requireLeadAccess(tenantId, leadId);
    return this.locks.withLock(tenantId, leadId, async () => {
      const state = await this.getOrCreateState(tenantId, leadId);
      await this.cancelPendingAiMessages(leadId, 'AI_HANDOFF_REQUIRED');
      state.ownershipStatus = 'waiting_for_human';
      state.escalationReason = reason.slice(0, 1_000);
      state.aiPausedReason = 'AI_HANDOFF_REQUIRED';
      await this.states.save(state);
      lead.recommendedNextAction =
        'Review the latest message and respond personally.';
      await this.leads.save(lead);
      await this.clientOperations.createHandoff(lead, reason, {
        priority,
        reason,
        recommendedAction: lead.recommendedNextAction,
      });
      return state;
    });
  }

  async setWorkspacePause(
    tenantId: string,
    paused: boolean,
    reason: string,
    actor: ConversationActor,
  ) {
    const settings = await this.getOrCreateSettings(tenantId);
    settings.aiPaused = paused;
    settings.aiPausedReason = paused
      ? String(reason || 'AI paused by a workspace administrator.').slice(0, 1_000)
      : null;
    await this.settings.save(settings);
    if (paused) {
      await this.messages
        .createQueryBuilder()
        .update(Message)
        .set({
          status: 'canceled',
          canceledAt: new Date(),
          errorCode: 'WORKSPACE_AI_PAUSED',
          sanitizedErrorMessage: 'Workspace AI was paused',
          lockedAt: null,
          lockedBy: null,
        })
        .where('authorship = :authorship', { authorship: 'ai' })
        .andWhere('status IN (:...statuses)', {
          statuses: PENDING_AI_MESSAGE_STATUSES,
        })
        .andWhere(
          '"leadId" IN (SELECT id FROM leads WHERE tenant_id = :tenantId)',
          { tenantId },
        )
        .execute();
      await this.states.update(
        { tenantId, ownershipStatus: 'ai_handling' },
        {
          ownershipStatus: 'paused',
          aiPausedReason: settings.aiPausedReason,
        },
      );
    }
    if (actor.userId) {
      await this.audit.record({
        tenantId,
        actorId: actor.userId,
        actorEmail: actor.email,
        action: paused ? 'workspace_ai_paused' : 'workspace_ai_pause_cleared',
        method: 'POST',
        path: '/ai/emergency-pause',
        statusCode: 200,
        metadata: { paused, reason: settings.aiPausedReason },
      });
    }
    return settings;
  }

  async setPlatformPause(
    paused: boolean,
    reason: string,
    actor: { id: string; email?: string | null },
  ) {
    const control = await this.getPlatformControl();
    control.paused = paused;
    control.reason = paused
      ? String(reason || 'Platform AI paused by an administrator.').slice(0, 1_000)
      : null;
    control.updatedById = actor.id;
    await this.platformControls.save(control);
    if (paused) {
      await Promise.all([
        this.messages
          .createQueryBuilder()
          .update(Message)
          .set({
            status: 'canceled',
            canceledAt: new Date(),
            errorCode: 'PLATFORM_AI_PAUSED',
            sanitizedErrorMessage: 'Platform AI was paused',
            lockedAt: null,
            lockedBy: null,
          })
          .where('authorship = :authorship', { authorship: 'ai' })
          .andWhere('status IN (:...statuses)', {
            statuses: PENDING_AI_MESSAGE_STATUSES,
          })
          .execute(),
        this.runs.update(
          { status: 'queued' },
          {
            status: 'blocked',
            errorCode: 'PLATFORM_AI_PAUSED',
            sanitizedError: 'Platform AI was paused',
            lockedAt: null,
            lockedBy: null,
          },
        ),
        this.states.update(
          { ownershipStatus: 'ai_handling' },
          {
            ownershipStatus: 'paused',
            aiPausedReason: control.reason,
          },
        ),
      ]);
    }
    await this.audit.record({
      tenantId: '00000000-0000-0000-0000-000000000000',
      actorId: actor.id,
      actorEmail: actor.email,
      action: paused ? 'platform_ai_paused' : 'platform_ai_pause_cleared',
      method: 'POST',
      path: '/admin/ai/emergency-pause',
      statusCode: 200,
      metadata: { paused, reason: control.reason },
    });
    return control;
  }

  async platformOverview() {
    const [
      control,
      settings,
      active,
      humanControlled,
      takeovers,
      escalations,
      failures,
      usage,
      usageLimitViolations,
    ] =
      await Promise.all([
        this.getPlatformControl(),
        this.settings.find({ order: { updatedAt: 'DESC' } }),
        this.states.count({ where: { ownershipStatus: 'ai_handling' } }),
        this.states.count({ where: { ownershipStatus: 'human_handling' } }),
        this.states.count({ where: { takenOverAt: Not(IsNull()) } }),
        this.states.count({ where: { ownershipStatus: 'waiting_for_human' } }),
        this.runs
          .createQueryBuilder('run')
          .select('run.status', 'status')
          .addSelect('COUNT(run.id)', 'count')
          .where('run.status IN (:...statuses)', {
            statuses: ['blocked', 'failed'],
          })
          .groupBy('run.status')
          .getRawMany(),
        this.runs
          .createQueryBuilder('run')
          .select('run.tenantId', 'tenantId')
          .addSelect('COALESCE(SUM(run.inputUsage + run.outputUsage), 0)', 'usage')
          .addSelect('COALESCE(SUM(run.estimatedCostUsd), 0)', 'cost')
          .groupBy('run.tenantId')
          .getRawMany(),
        this.runs.count({
          where: {
            errorCode: In([
              'CONVERSATION_USAGE_LIMIT',
              'WORKSPACE_USAGE_LIMIT',
              'MAXIMUM_AI_TURNS_REACHED',
            ]),
          },
        }),
      ]);
    const tenantIds = settings.map((row) => row.tenantId);
    const tenants = tenantIds.length
      ? await this.tenants.find({ where: { id: In(tenantIds) } })
      : [];
    const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
    const usageByTenant = new Map(usage.map((row) => [row.tenantId, row]));
    return {
      platformPaused: control.paused,
      platformPauseReason: control.reason || null,
      aiEnabledClients: settings.filter((row) => row.aiEnabled).length,
      activeAiConversations: active,
      humanControlledConversations: humanControlled,
      humanTakeovers: takeovers,
      waitingForHuman: escalations,
      failedRuns: Number(
        failures.find((row) => row.status === 'failed')?.count || 0,
      ),
      blockedRuns: Number(
        failures.find((row) => row.status === 'blocked')?.count || 0,
      ),
      usageLimitViolations,
      clients: settings.map((row) => {
        const clientUsage = usageByTenant.get(row.tenantId);
        return {
          tenantId: row.tenantId,
          tenantName: tenantById.get(row.tenantId)?.name || 'Client workspace',
          aiEnabled: row.aiEnabled,
          aiPaused: row.aiPaused,
          mode: row.responseMode,
          configurationApprovalStatus: row.configurationApprovalStatus,
          usage: Number(clientUsage?.usage || 0),
          estimatedCostUsd: Number(clientUsage?.cost || 0),
          monthlyUsageLimit: row.monthlyWorkspaceUsageLimit,
        };
      }),
    };
  }

  private async requireDraft(leadId: string, messageId: string) {
    const message = await this.messages.findOne({
      where: {
        id: messageId,
        leadId,
        authorship: 'ai',
        status: 'draft',
      },
    });
    if (!message) throw new NotFoundException('AI draft not found');
    return message;
  }

  private async cancelPendingAiMessages(
    leadId: string,
    code: string,
    exceptMessageId?: string,
  ) {
    const query = this.messages
      .createQueryBuilder()
      .update(Message)
      .set({
        status: 'canceled',
        canceledAt: new Date(),
        errorCode: code,
        sanitizedErrorMessage: 'Canceled because a human controls the conversation',
        lockedAt: null,
        lockedBy: null,
      })
      .where('"leadId" = :leadId', { leadId })
      .andWhere('authorship = :authorship', { authorship: 'ai' })
      .andWhere('status IN (:...statuses)', {
        statuses: PENDING_AI_MESSAGE_STATUSES,
      });
    if (exceptMessageId) {
      query.andWhere('id != :exceptMessageId', { exceptMessageId });
    }
    return query.execute();
  }

  private async requireLeadAccess(
    tenantId: string,
    leadId: string,
    actor?: ConversationActor,
  ) {
    const lead = await this.leads.findOne({ where: { id: leadId, tenantId } });
    if (!lead) throw new NotFoundException('Lead not found');
    const admin =
      actor?.role === 'owner' ||
      (actor?.role ? hasAtLeastRole(actor.role, 'admin') : false);
    if (
      actor?.userId &&
      !admin &&
      lead.assignedToUserId !== actor.userId
    ) {
      throw new ForbiddenException('Lead is not assigned to this user.');
    }
    return lead;
  }

  private async getOrCreateSettings(tenantId: string) {
    const existing = await this.settings.findOne({ where: { tenantId } });
    if (existing) return existing;
    try {
      return await this.settings.save(
        this.settings.create({
          tenantId,
          aiEnabled: false,
          responseMode: 'human_only',
          maximumAutomaticTurns: 6,
          minimumConfidenceThreshold: 0.82,
          perConversationUsageLimit: 12_000,
          monthlyWorkspaceUsageLimit: 500_000,
          aiPaused: false,
          configurationApprovalStatus: 'draft',
          lastConfigurationUpdate: new Date(),
        }),
      );
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      return this.settings.findOneOrFail({ where: { tenantId } });
    }
  }

  private async getPlatformControl() {
    const existing = await this.platformControls.findOne({
      where: { id: 'global' },
    });
    if (existing) return existing;
    try {
      return await this.platformControls.save(
        this.platformControls.create({
          id: 'global',
          paused: false,
          reason: null,
        }),
      );
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      return this.platformControls.findOneOrFail({ where: { id: 'global' } });
    }
  }
}
