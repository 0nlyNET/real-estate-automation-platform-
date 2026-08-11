import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ConversationLockService } from '../../common/conversation-lock.service';
import { nextAllowedSendTime } from '../../common/time';
import { operationalEvent, sanitizeOperationalText } from '../../common/operational-log';
import { ClientOperationsService } from '../client-operations/client-operations.service';
import { ComplianceService } from '../compliance/compliance.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { Credential } from '../settings/credential.entity';
import { decryptIntegrationPayload } from '../integrations/integrations.service';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationsService } from '../operations/operations.service';
import { AiRun } from './ai-run.entity';
import { AiAuditService } from './ai-audit.service';
import { AiConversationControlService } from './ai-conversation-control.service';
import { AiPolicyService } from './ai-policy.service';
import { AiToolService, AiToolResult } from './ai-tool.service';
import {
  AI_PROVIDER,
  AiProvider,
  AiProviderOutput,
  AiToolRequest,
} from './ai.types';
import { AiUsageService } from './ai-usage.service';
import { BrokerageKnowledge } from './brokerage-knowledge.entity';
import { ConversationAiState } from './conversation-ai-state.entity';
import { PlatformAiControl } from './platform-ai-control.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';
import { LimitsService } from '../limits/limits.service';
import { ProviderConfigService } from '../integrations/provider-config.service';

type AiConversationEvent = {
  tenantId: string;
  leadId: string;
  messageId: string | null;
  channel: 'sms' | 'email';
  triggerType: 'inbound' | 'first_response';
};

type PreflightContext = {
  settings: WorkspaceAiSettings;
  knowledge: BrokerageKnowledge;
  state: ConversationAiState;
  lead: Lead;
  triggeringMessage: Message | null;
};

type PreflightDecision =
  | ({ allowed: true } & PreflightContext)
  | ({
      allowed: false;
      code: string;
      reason: string;
      priority: 'normal' | 'high' | 'urgent';
    } & Partial<PreflightContext>);

type EscalationContext = Pick<PreflightContext, 'settings' | 'state' | 'lead'> & {
  triggeringMessage: Message;
};

const AI_RUN_LEASE_SECONDS = 120;
const MAX_AI_RUN_ATTEMPTS = 3;

@Injectable()
export class AiConversationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AiConversationService.name);
  private readonly workerId = `ai-${process.env.HOSTNAME || process.pid}`;
  private workerTimer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AiRun)
    private readonly runs: Repository<AiRun>,
    @InjectRepository(WorkspaceAiSettings)
    private readonly settings: Repository<WorkspaceAiSettings>,
    @InjectRepository(BrokerageKnowledge)
    private readonly knowledge: Repository<BrokerageKnowledge>,
    @InjectRepository(ConversationAiState)
    private readonly states: Repository<ConversationAiState>,
    @InjectRepository(PlatformAiControl)
    private readonly platformControls: Repository<PlatformAiControl>,
    @InjectRepository(Lead)
    private readonly leads: Repository<Lead>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(Credential)
    private readonly credentials: Repository<Credential>,
    @Inject(AI_PROVIDER)
    private readonly provider: AiProvider,
    private readonly locks: ConversationLockService,
    private readonly control: AiConversationControlService,
    private readonly policy: AiPolicyService,
    private readonly tools: AiToolService,
    private readonly usage: AiUsageService,
    private readonly audit: AiAuditService,
    private readonly compliance: ComplianceService,
    private readonly entitlements: EntitlementService,
    private readonly clientOperations: ClientOperationsService,
    private readonly notifications: NotificationsService,
    private readonly operations: OperationsService,
    @Optional() private readonly limits?: LimitsService,
    @Optional() private readonly providerConfig?: ProviderConfigService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.workerTimer = setInterval(() => {
      void this.processPendingRuns(10).catch((error: unknown) => {
        this.logger.error(
          operationalEvent('ai_worker_failed', {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    }, 3_000);
    this.workerTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.workerTimer) clearInterval(this.workerTimer);
  }

  /**
   * Called after a verified inbound provider event is durably stored and opt-out
   * handling is complete. This method never calls the model in the webhook
   * request; it only records a durable, idempotent job.
   */
  async acceptInbound(event: Omit<AiConversationEvent, 'triggerType'> & { messageId: string }) {
    const inboundEvent: AiConversationEvent = { ...event, triggerType: 'inbound' };
    const [lead, message, settings] = await Promise.all([
      this.leads.findOne({
        where: { id: event.leadId, tenantId: event.tenantId },
      }),
      this.messages.findOne({
        where: {
          id: event.messageId,
          leadId: event.leadId,
          direction: 'inbound',
        },
      }),
      this.settings.findOne({ where: { tenantId: event.tenantId } }),
    ]);
    if (!lead || !message) return { status: 'ignored' as const };

    const aiSettings = settings || (await this.defaultSettings(event.tenantId));
    const desiredDefault =
      aiSettings.aiEnabled && aiSettings.responseMode !== 'human_only'
        ? 'ai_handling'
        : 'human_handling';
    const state = await this.control.getOrCreateState(
      event.tenantId,
      event.leadId,
      desiredDefault,
    );

    if (
      !aiSettings.aiEnabled ||
      aiSettings.responseMode === 'human_only' ||
      aiSettings.aiPaused ||
      state.ownershipStatus !== 'ai_handling'
    ) {
      await this.notifyInboundForHuman(lead, message.id);
      return { status: 'stored_for_human' as const };
    }
    if (state.lastInboundMessageIdProcessed === message.id) {
      return { status: 'duplicate' as const };
    }

    const deterministicEscalation = this.policy.classifyInbound(message.body);
    if (deterministicEscalation) {
      const run = await this.createRun(inboundEvent, aiSettings.responseMode, 'blocked');
      if (run) {
        run.errorCode = deterministicEscalation.code;
        run.sanitizedError = deterministicEscalation.reason;
        await this.runs.save(run);
      }
      await this.escalate(
        {
          settings: aiSettings,
          state,
          lead,
          triggeringMessage: message,
        },
        deterministicEscalation.code,
        deterministicEscalation.reason,
        deterministicEscalation.priority,
      );
      return { status: 'escalated' as const };
    }

    const preflight = await this.preflight(inboundEvent);
    if (!preflight.allowed) {
      const run = await this.createRun(inboundEvent, aiSettings.responseMode, 'blocked');
      if (run) {
        run.errorCode = preflight.code;
        run.sanitizedError = preflight.reason;
        await this.runs.save(run);
      }
      await this.escalate(
        {
          settings: preflight.settings || aiSettings,
          state: preflight.state || state,
          lead: preflight.lead || lead,
          triggeringMessage: preflight.triggeringMessage || message,
        },
        preflight.code,
        preflight.reason,
        preflight.priority,
      );
      return { status: 'blocked' as const, code: preflight.code };
    }

    const run = await this.createRun(inboundEvent, aiSettings.responseMode, 'queued');
    return run
      ? { status: 'queued' as const, runId: run.id }
      : { status: 'duplicate' as const };
  }

  /** Queue the first AI response after lead intake without fabricating an
   * inbound message. The normal worker, controls, consent, provider readiness,
   * usage limits, quiet hours, and takeover locks still apply. */
  async acceptLead(event: { tenantId: string; leadId: string }) {
    const [lead, settings] = await Promise.all([
      this.leads.findOne({ where: { id: event.leadId, tenantId: event.tenantId } }),
      this.settings.findOne({ where: { tenantId: event.tenantId } }),
    ]);
    if (
      !lead ||
      !settings?.aiEnabled ||
      settings.aiFirstResponderEnabled === false ||
      settings.aiPaused ||
      settings.responseMode === 'human_only'
    ) {
      return { status: 'ignored' as const, code: 'AI_NOT_ENABLED' };
    }
    const state = await this.control.getOrCreateState(
      event.tenantId,
      event.leadId,
      'ai_handling',
    );
    if (state.ownershipStatus !== 'ai_handling') {
      return { status: 'ignored' as const, code: 'HUMAN_CONTROLLED' };
    }
    const allowedChannels = new Set(
      settings.allowedChannels?.length ? settings.allowedChannels : ['sms', 'email'],
    );
    const candidates: Array<'sms' | 'email'> = [];
    if (allowedChannels.has('sms') && lead.smsEligible && lead.phone) candidates.push('sms');
    if (allowedChannels.has('email') && lead.emailEligible && lead.email) candidates.push('email');
    for (const channel of candidates) {
      const aiEvent: AiConversationEvent = {
        tenantId: event.tenantId,
        leadId: event.leadId,
        messageId: null,
        channel,
        triggerType: 'first_response',
      };
      const preflight = await this.preflight(aiEvent);
      if (!preflight.allowed) continue;
      const run = await this.createRun(aiEvent, settings.responseMode, 'queued');
      return run
        ? { status: 'queued' as const, runId: run.id, channel }
        : { status: 'duplicate' as const, channel };
    }
    return { status: 'ignored' as const, code: 'NO_ELIGIBLE_AI_CHANNEL' };
  }

  async processPendingRuns(limit = 10) {
    const boundedLimit = Math.min(Math.max(limit, 1), 50);
    const recovered = await this.recoverExhaustedRuns(boundedLimit);
    const ids = await this.claimRuns(boundedLimit);
    for (const id of ids) {
      await this.processRun(id);
    }
    return { claimed: ids.length, recovered };
  }

  private async recoverExhaustedRuns(limit: number) {
    const rows: Array<{ id: string; tenantId: string; leadId: string }> =
      await this.dataSource.transaction(async (manager) =>
        manager.query(
          `WITH candidates AS (
             SELECT id
             FROM ai_runs
             WHERE status IN ('queued', 'processing')
               AND attempt_count >= $2
               AND (
                 status = 'queued'
                 OR locked_at IS NULL
                 OR locked_at < now() - ($1 * interval '1 second')
               )
             ORDER BY created_at ASC
             FOR UPDATE SKIP LOCKED
             LIMIT $3
           )
           UPDATE ai_runs AS run
           SET status = 'failed',
               error_code = 'AI_RUN_ATTEMPTS_EXHAUSTED',
               sanitized_error = 'AI processing was interrupted repeatedly and requires human review.',
               locked_at = NULL,
               locked_by = NULL
           FROM candidates
           WHERE run.id = candidates.id
           RETURNING run.id, run.tenant_id AS "tenantId", run.lead_id AS "leadId"`,
          [AI_RUN_LEASE_SECONDS, MAX_AI_RUN_ATTEMPTS, limit],
        ),
      );
    for (const row of rows) {
      await this.operations.createTask({
        tenantId: row.tenantId,
        category: 'ai_provider_failure',
        title: 'AI processing needs human follow-up',
        description:
          'AI processing was interrupted repeatedly. The inbound message remains stored and the conversation was escalated for human review.',
        priority: 'high',
        relatedEntityType: 'ai_run',
        relatedEntityId: row.id,
        dedupeOpen: true,
      });
      await this.control.markWaitingForHuman(
        row.tenantId,
        row.leadId,
        'AI processing was interrupted repeatedly. Review the latest inbound message and respond personally.',
        'high',
      );
    }
    return rows.length;
  }

  private claimRuns(limit: number): Promise<string[]> {
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{ id: string }> = await manager.query(
        `WITH candidates AS (
           SELECT id
           FROM ai_runs
           WHERE status IN ('queued', 'processing')
             AND attempt_count < $4
             AND (
               status = 'queued'
               OR locked_at IS NULL
               OR locked_at < now() - ($1 * interval '1 second')
             )
           ORDER BY created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE ai_runs AS run
         SET status = 'processing',
             locked_at = now(),
             locked_by = $3,
             attempt_count = run.attempt_count + 1
         FROM candidates
         WHERE run.id = candidates.id
         RETURNING run.id`,
        [AI_RUN_LEASE_SECONDS, limit, this.workerId, MAX_AI_RUN_ATTEMPTS],
      );
      return rows.map((row) => row.id);
    });
  }

  private async processRun(runId: string) {
    const run = await this.runs.findOne({
      where: { id: runId, lockedBy: this.workerId },
    });
    if (!run) return;
    const event: AiConversationEvent = {
      tenantId: run.tenantId,
      leadId: run.leadId,
      messageId: run.triggeringMessageId,
      channel:
        run.promptMetadata?.channel === 'email' ? 'email' : 'sms',
      triggerType: run.triggerType || 'inbound',
    };
    const trigger = run.triggeringMessageId
      ? await this.messages.findOne({
          where: { id: run.triggeringMessageId, leadId: run.leadId },
        })
      : null;
    if (trigger) event.channel = trigger.channel;

    const preflight = await this.preflight(event);
    if (!preflight.allowed) {
      await this.blockRun(
        run,
        preflight.code,
        preflight.reason,
        preflight.priority,
        preflight,
      );
      return;
    }

    try {
      const recentMessages = await this.contextMessages(run.leadId);
      const firstAiResponse =
        (await this.messages.count({
          where: {
            leadId: run.leadId,
            direction: 'outbound',
            authorship: 'ai',
          },
        })) === 0;
      run.promptMetadata = {
        channel: event.channel,
        messageCount: recentMessages.length,
        contextCharacters: recentMessages.reduce(
          (sum, message) => sum + message.body.length,
          0,
        ),
        knowledgeVersion: preflight.knowledge.updatedAt?.toISOString() || null,
        firstAiResponse,
        triggerType: run.triggerType,
      };
      await this.runs.save(run);

      const usageReservation = await this.limits?.reserveUsage({
        tenantId: run.tenantId,
        metric: 'ai',
        idempotencyKey: `ai-run:${run.id}`,
      });
      if (usageReservation && !usageReservation.ok) {
        await this.blockRun(
          run,
          usageReservation.code,
          usageReservation.message,
          'urgent',
          preflight,
        );
        return;
      }

      const result = await this.provider.generate({
        mode: run.mode,
        channel: event.channel,
        identityLabel: preflight.settings.identityLabel as string,
        firstAiResponse,
        lead: this.providerLeadContext(preflight.lead),
        conversationSummary: preflight.lead.conversationSummary || null,
        recentMessages,
        knowledge: preflight.knowledge,
        settings: preflight.settings,
      });
      run.provider = result.provider;
      run.model = result.model;
      run.confidence = result.confidence;
      run.inputUsage = result.inputUsage;
      run.outputUsage = result.outputUsage;
      run.estimatedCostUsd = this.usage.estimateCost(
        result.inputUsage,
        result.outputUsage,
      );
      run.latencyMs = result.latencyMs;
      run.structuredResponse = {
        reply: result.reply,
        confidence: result.confidence,
        classification: result.classification,
        escalationReason: result.escalationReason,
        summary: result.summary,
        recommendedNextAction: result.recommendedNextAction,
        leadTemperature: result.leadTemperature,
      };
      run.requestedTools = result.actions;
      await this.runs.save(run);

      const output: AiProviderOutput = {
        reply: result.reply
          ? this.policy.ensureRequiredDisclaimer(
              this.policy.ensureIdentityDisclosure(
                result.reply,
                preflight.settings.identityLabel as string,
                firstAiResponse,
              ),
              preflight.knowledge.requiredDisclaimer,
            )
          : null,
        confidence: result.confidence,
        classification: result.classification,
        escalationReason: result.escalationReason,
        summary: result.summary,
        recommendedNextAction: result.recommendedNextAction,
        leadTemperature: result.leadTemperature,
        actions: result.actions,
      };
      if (output.classification === 'handoff' || output.escalationReason) {
        await this.blockRun(
          run,
          'MODEL_REQUESTED_HANDOFF',
          output.escalationReason ||
            'The AI determined that a human should handle this conversation.',
          'high',
          preflight,
        );
        return;
      }
      if (output.confidence < preflight.settings.minimumConfidenceThreshold) {
        await this.blockRun(
          run,
          'LOW_CONFIDENCE',
          'The AI response did not meet the workspace confidence threshold.',
          'high',
          preflight,
        );
        return;
      }
      const requested = this.withRequiredOperationalUpdates(output);
      const toolResults: AiToolResult[] = [];
      let verifiedBookingLink: string | null = null;
      for (let index = 0; index < requested.length; index += 1) {
        const toolResult = await this.tools.execute(
          {
            run,
            lead: preflight.lead,
            triggeringMessage: preflight.triggeringMessage,
            settings: preflight.settings,
            knowledge: preflight.knowledge,
            state: preflight.state,
            channel: event.channel,
          },
          requested[index],
          index,
        );
        toolResults.push(toolResult);
        run.executedTools = toolResults.filter(
          (item) => item.status === 'executed',
        ) as unknown as Array<Record<string, unknown>>;
        run.blockedTools = toolResults.filter(
          (item) => item.status === 'blocked',
        ) as unknown as Array<Record<string, unknown>>;
        await this.runs.save(run);
        if (toolResult.status === 'blocked') {
          await this.blockRun(
            run,
            toolResult.code || 'AI_TOOL_BLOCKED',
            toolResult.reason || 'An AI tool did not pass validation.',
            'high',
            preflight,
          );
          return;
        }
        if (typeof toolResult.output?.bookingLink === 'string') {
          verifiedBookingLink = toolResult.output.bookingLink;
        }
      }
      if (verifiedBookingLink && output.reply) {
        if (!output.reply.includes(verifiedBookingLink)) {
          output.reply = `${output.reply}\n\nBook a time: ${verifiedBookingLink}`;
        }
      }
      if (preflight.state.ownershipStatus !== 'ai_handling') {
        run.status = 'completed';
        run.lockedAt = null;
        run.lockedBy = null;
        await this.runs.save(run);
        return;
      }

      const validation = this.policy.validateResponse({
        output,
        settings: preflight.settings,
        knowledge: preflight.knowledge,
        identityLabel: preflight.settings.identityLabel as string,
        firstAiResponse,
        channel: event.channel,
        verifiedBookingLink,
      });
      if (!validation.allowed) {
        await this.blockRun(
          run,
          validation.code || 'AI_RESPONSE_BLOCKED',
          validation.reason || 'The AI response did not pass validation.',
          'high',
          preflight,
        );
        return;
      }
      if (validation.noReply || !output.reply) {
        await this.completeWithoutReply(run, preflight);
        return;
      }

      const body =
        event.channel === 'email'
          ? `${output.reply}\n\nUnsubscribe: {{unsubscribeUrl}}`
          : output.reply;
      const message = await this.finalizeMessage(
        run,
        preflight,
        event.channel,
        body,
        Boolean(verifiedBookingLink),
      );
      run.status =
        run.mode === 'draft' ? 'drafted' : 'response_queued';
      run.lockedAt = null;
      run.lockedBy = null;
      await this.runs.save(run);
      await this.audit.recordSystem(run.leadId, 'ai_response_prepared', {
        runId: run.id,
        messageId: message.id,
        mode: run.mode,
        status: message.status,
        confidence: run.confidence,
        requestedTools: run.requestedTools.map((item: any) => item.name),
        executedTools: run.executedTools.map((item: any) => item.name),
      });
      if (run.mode === 'draft') {
        await this.notifications.createForTenant({
          tenantId: run.tenantId,
          assignedUserId: preflight.lead.assignedToUserId,
          eventType: 'ai.draft_ready',
          category: 'leads',
          severity: 'info',
          title: `Draft ready for ${preflight.lead.fullName}`,
          message: 'Review, edit, approve, reject, or take over the conversation.',
          deduplicationKey: `ai-draft:${message.id}`,
          actionUrl: `/app/inbox?leadId=${preflight.lead.id}`,
          entityType: 'message',
          entityId: message.id,
        });
      }
    } catch (error: any) {
      const sanitized = sanitizeOperationalText(
        error?.response?.message || error?.message || 'AI provider failed',
      ).slice(0, 1_000);
      await this.blockRun(
        run,
        String(error?.response?.code || error?.code || 'AI_PROVIDER_FAILED'),
        sanitized,
        'high',
        preflight,
        true,
      );
    }
  }

  private async preflight(event: AiConversationEvent): Promise<PreflightDecision> {
    const [settings, knowledge, lead, trigger, control] = await Promise.all([
      this.settings.findOne({ where: { tenantId: event.tenantId } }),
      this.knowledge.findOne({ where: { tenantId: event.tenantId } }),
      this.leads.findOne({
        where: { id: event.leadId, tenantId: event.tenantId },
      }),
      event.messageId
        ? this.messages.findOne({
            where: {
              id: event.messageId,
              leadId: event.leadId,
              direction: 'inbound',
            },
          })
        : Promise.resolve(null),
      this.platformControls.findOne({ where: { id: 'global' } }),
    ]);
    const state = await this.control.getOrCreateState(
      event.tenantId,
      event.leadId,
    );
    const deny = (
      code: string,
      reason: string,
      priority: 'normal' | 'high' | 'urgent' = 'high',
    ): PreflightDecision => ({
      allowed: false,
      code,
      reason,
      priority,
      settings: settings || undefined,
      knowledge: knowledge || undefined,
      state,
      lead: lead || undefined,
      triggeringMessage: trigger || undefined,
    });
    if (!settings || !lead || (event.triggerType === 'inbound' && !trigger)) {
      return deny('AI_CONTEXT_MISSING', 'Required AI conversation context is unavailable.');
    }
    if (control?.paused) {
      return deny('PLATFORM_AI_PAUSED', control.reason || 'Platform AI is paused.');
    }
    if (
      !settings.aiEnabled ||
      settings.aiPaused ||
      settings.responseMode === 'human_only'
    ) {
      return deny(
        'WORKSPACE_AI_PAUSED',
        settings.aiPausedReason || 'Workspace AI is disabled or paused.',
      );
    }
    const allowedChannels = settings.allowedChannels?.length
      ? settings.allowedChannels
      : ['sms', 'email'];
    if (!allowedChannels.includes(event.channel)) {
      return deny(
        'AI_CHANNEL_NOT_ALLOWED',
        `AI is not approved for ${event.channel} in this workspace.`,
        'normal',
      );
    }
    if (state.ownershipStatus !== 'ai_handling') {
      return deny(
        'CONVERSATION_NOT_AI_CONTROLLED',
        'The conversation is controlled by a human.',
        'normal',
      );
    }
    if (trigger && state.lastInboundMessageIdProcessed === trigger.id) {
      return deny('DUPLICATE_INBOUND', 'The inbound message was already processed.', 'normal');
    }
    if (
      settings.configurationApprovalStatus !== 'approved' ||
      !settings.identityLabel?.trim()
    ) {
      return deny(
        'AI_CONFIGURATION_NOT_APPROVED',
        'AI identity and workspace settings are not approved.',
      );
    }
    if (!knowledge || knowledge.approvalStatus !== 'approved') {
      return deny(
        'KNOWLEDGE_NOT_APPROVED',
        'Verified brokerage information is unavailable or unapproved.',
      );
    }
    if (state.aiTurnCount >= settings.maximumAutomaticTurns) {
      return deny(
        'MAXIMUM_AI_TURNS_REACHED',
        'The conversation reached its maximum consecutive AI turns.',
      );
    }
    const entitlement = await this.entitlements.evaluate(
      event.tenantId,
      event.channel === 'sms'
        ? 'send_automated_sms'
        : 'send_automated_email',
      new Date(),
      { controlledTest: Boolean(lead.testRunId) },
    );
    if (!entitlement.allowed) {
      return deny('SERVICE_NOT_ENTITLED', entitlement.reasons.join('; '));
    }
    const consent = await this.compliance.communicationEligibility(
      event.tenantId,
      lead,
      event.channel,
    );
    if (!consent.allowed) {
      return deny(
        consent.code || 'MISSING_CONSENT',
        consent.reason || 'Consent is not valid.',
      );
    }
    const provider = event.channel === 'sms' ? 'twilio' : 'sendgrid';
    const integration = this.providerConfig
      ? event.channel === 'sms'
        ? await this.providerConfig.resolveTwilio(event.tenantId, {
            allowTesting: Boolean(lead.testRunId),
          })
        : await this.providerConfig.resolveSendGrid(event.tenantId, {
            allowTesting: Boolean(lead.testRunId),
          })
      : await this.legacyProviderConfiguration(event.tenantId, provider);
    if (!integration || ('connected' in integration && !integration.connected)) {
      return deny(
        'MESSAGE_PROVIDER_NOT_READY',
        `${provider} is not connected and tested for this workspace.`,
      );
    }
    if (!String(process.env.OPENAI_API_KEY || '').trim()) {
      return deny('AI_PROVIDER_NOT_CONFIGURED', 'The AI provider is not configured.');
    }
    const limits = await this.usage.evaluateLimits(settings, state);
    if (!limits.allowed) {
      return deny(
        limits.code || 'AI_USAGE_LIMIT',
        limits.reason || 'AI usage limit reached.',
      );
    }
    return {
      allowed: true,
      settings,
      knowledge,
      state,
      lead,
      triggeringMessage: trigger,
    };
  }

  private async legacyProviderConfiguration(
    tenantId: string,
    provider: 'twilio' | 'sendgrid',
  ) {
    const credential = await this.credentials.findOne({
      where: { provider, tenant: { id: tenantId } as any },
      relations: ['tenant'],
    });
    return credential ? decryptIntegrationPayload(credential.encryptedValue) : null;
  }

  private async createRun(
    event: AiConversationEvent,
    mode: WorkspaceAiSettings['responseMode'],
    status: AiRun['status'],
  ) {
    const existing = await this.runs.findOne({
      where: event.messageId
        ? { triggeringMessageId: event.messageId }
        : { leadId: event.leadId, triggerType: 'first_response' },
    });
    if (existing) return null;
    try {
      return await this.runs.save(
        this.runs.create({
          tenantId: event.tenantId,
          leadId: event.leadId,
          triggeringMessageId: event.messageId,
          triggerType: event.triggerType,
          provider: 'openai',
          mode,
          status,
          promptMetadata: {
            channel: event.channel,
            triggerType: event.triggerType,
            contentsStored: false,
          },
          requestedTools: [],
          executedTools: [],
          blockedTools: [],
          inputUsage: 0,
          outputUsage: 0,
          attemptCount: 0,
        }),
      );
    } catch (error: any) {
      if (String(error?.code || '') === '23505') return null;
      throw error;
    }
  }

  private async defaultSettings(tenantId: string) {
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

  private async contextMessages(leadId: string) {
    const configured = Number(process.env.AI_MAX_CONTEXT_CHARACTERS || 12_000);
    const maxCharacters =
      Number.isInteger(configured) && configured >= 2_000 && configured <= 40_000
        ? configured
        : 12_000;
    const rows = await this.messages.find({
      where: { leadId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    let used = 0;
    const selected: Message[] = [];
    for (const row of rows) {
      const body = row.body.slice(0, 2_000);
      if (selected.length >= 12 || used + body.length > maxCharacters) break;
      used += body.length;
      selected.push(Object.assign(row, { body }));
    }
    return selected.reverse().map((message) => ({
      direction: message.direction,
      channel: message.channel,
      body: message.body,
      authorship: message.authorship || 'system',
      createdAt: message.createdAt.toISOString(),
    }));
  }

  private providerLeadContext(lead: Lead) {
    return {
      id: lead.id,
      fullName: lead.fullName,
      leadType: lead.leadType,
      stage: lead.stage,
      location: lead.location || null,
      propertyInterest: lead.propertyInterest || null,
      timeline: lead.timeline || null,
      budget: lead.budgetRange || lead.estimatedPrice || null,
      preapproved: lead.preapproved || null,
      preferredAreas: lead.preferredAreas || [],
      bestTimeToTalk: lead.bestTimeToTalk || null,
      temperature: lead.temperature,
      readiness: lead.readinessLevel,
      qualificationData: lead.qualificationData || {},
      recommendedNextAction: lead.recommendedNextAction || null,
    };
  }

  private withRequiredOperationalUpdates(output: AiProviderOutput) {
    const actions = [...output.actions];
    const add = (name: AiToolRequest['name'], args: Record<string, unknown>) => {
      if (!actions.some((action) => action.name === name)) {
        actions.push({ name, arguments: JSON.stringify(args) });
      }
    };
    if (output.summary.trim()) {
      add('update_conversation_summary', { summary: output.summary });
    }
    if (output.recommendedNextAction.trim()) {
      add('set_next_action', {
        nextAction: output.recommendedNextAction,
      });
    }
    if (output.leadTemperature !== 'unchanged') {
      add('set_lead_temperature', {
        temperature: output.leadTemperature,
        reason: output.summary || 'Updated from the current conversation.',
      });
    }
    return actions.slice(0, 10);
  }

  private async finalizeMessage(
    run: AiRun,
    context: PreflightContext,
    channel: 'sms' | 'email',
    body: string,
    requiresBookingLink: boolean,
  ) {
    return this.locks.withLock(run.tenantId, run.leadId, async () => {
      const [state, settings, existing, latestInboundEmail] = await Promise.all([
        this.states.findOne({
          where: { tenantId: run.tenantId, leadId: run.leadId },
        }),
        this.settings.findOne({ where: { tenantId: run.tenantId } }),
        this.messages.findOne({
          where: { idempotencyKey: `ai:${run.id}` },
        }),
        channel === 'email'
          ? this.messages.findOne({
              where: {
                leadId: run.leadId,
                channel: 'email',
                direction: 'inbound',
              },
              order: { createdAt: 'DESC' },
            })
          : Promise.resolve(null),
      ]);
      if (existing) return existing;
      if (
        !state ||
        state.ownershipStatus !== 'ai_handling' ||
        !settings?.aiEnabled ||
        settings.aiPaused
      ) {
        throw Object.assign(new Error('Conversation changed before AI response was queued'), {
          code: 'CONVERSATION_STATE_CHANGED',
        });
      }
      const quiet = await this.compliance.getQuietHours(run.tenantId);
      const now = new Date();
      const scheduledAt = quiet.enabled
        ? nextAllowedSendTime({
            now,
            timeZone: quiet.timezone,
            quietStart: `${String(Math.floor(quiet.startMinute / 60)).padStart(2, '0')}:${String(quiet.startMinute % 60).padStart(2, '0')}`,
            quietEnd: `${String(Math.floor(quiet.endMinute / 60)).padStart(2, '0')}:${String(quiet.endMinute % 60).padStart(2, '0')}`,
          })
        : now;
      const message = await this.messages.save(
        this.messages.create({
          leadId: run.leadId,
          channel,
          direction: 'outbound',
          body,
          subject:
            channel === 'email'
              ? replySubject(latestInboundEmail?.subject)
              : null,
          inReplyToProviderMessageId:
            channel === 'email'
              ? latestInboundEmail?.providerMessageId || null
              : null,
          status: run.mode === 'draft' ? 'draft' : 'queued',
          scheduledAt:
            run.mode === 'draft' || scheduledAt <= now ? undefined : scheduledAt,
          attemptCount: 0,
          idempotencyKey: `ai:${run.id}`,
          authorship: 'ai',
          aiRunId: run.id,
          communicationType: channel,
          requiresBookingLink,
        }),
      );
      if (run.triggeringMessageId) {
        state.lastInboundMessageIdProcessed = run.triggeringMessageId;
      }
      state.lastAiResponseId = message.id;
      state.aiTurnCount += 1;
      state.usageUnits += run.inputUsage + run.outputUsage;
      await this.states.save(state);
      return message;
    });
  }

  private async completeWithoutReply(run: AiRun, context: PreflightContext) {
    if (run.triggeringMessageId) {
      context.state.lastInboundMessageIdProcessed = run.triggeringMessageId;
    }
    context.state.usageUnits += run.inputUsage + run.outputUsage;
    await this.states.save(context.state);
    run.status = 'completed';
    run.lockedAt = null;
    run.lockedBy = null;
    await this.runs.save(run);
    await this.audit.recordSystem(run.leadId, 'ai_run_completed_without_reply', {
      runId: run.id,
      classification: run.structuredResponse?.classification || 'no_reply',
    });
  }

  private async blockRun(
    run: AiRun,
    code: string,
    reason: string,
    priority: 'normal' | 'high' | 'urgent',
    context: Partial<PreflightContext>,
    providerFailure = false,
  ) {
    run.status = providerFailure ? 'failed' : 'blocked';
    run.errorCode = code.slice(0, 80);
    run.sanitizedError = sanitizeOperationalText(reason).slice(0, 1_000);
    run.lockedAt = null;
    run.lockedBy = null;
    await this.runs.save(run);
    if (
      context.settings &&
      context.state &&
      context.lead &&
      context.triggeringMessage
    ) {
      await this.escalate(
        context as EscalationContext,
        code,
        reason,
        priority,
      );
    }
    if (providerFailure) {
      await this.operations.createTask({
        tenantId: run.tenantId,
        category: 'ai_provider_failure',
        title: 'AI response needs human follow-up',
        description: run.sanitizedError,
        priority: priority === 'urgent' ? 'critical' : 'high',
        relatedEntityType: 'ai_run',
        relatedEntityId: run.id,
        dedupeOpen: true,
      });
    }
    await this.audit.recordSystem(run.leadId, 'ai_run_blocked', {
      runId: run.id,
      status: run.status,
      code,
      reason: run.sanitizedError,
    });
  }

  private async escalate(
    context: EscalationContext,
    code: string,
    reason: string,
    priority: 'normal' | 'high' | 'urgent',
  ) {
    context.state.ownershipStatus = 'waiting_for_human';
    context.state.escalationReason = reason.slice(0, 1_000);
    context.state.aiPausedReason = code;
    context.state.lastInboundMessageIdProcessed =
      context.triggeringMessage.id;
    await this.states.save(context.state);
    context.lead.recommendedNextAction =
      'Review the latest message and respond personally.';
    await this.leads.save(context.lead);
    await this.clientOperations.createHandoff(
      context.lead,
      context.triggeringMessage.body,
      {
        priority,
        reason,
        recommendedAction:
          context.lead.recommendedNextAction,
      },
    );
  }

  private async notifyInboundForHuman(lead: Lead, messageId: string) {
    await this.notifications.createForTenant({
      tenantId: lead.tenantId,
      assignedUserId: lead.assignedToUserId,
      eventType: 'lead.replied',
      category: 'leads',
      severity: 'info',
      title: `${lead.fullName} replied`,
      message: 'The conversation is human-controlled. Open the inbox to respond.',
      deduplicationKey: `human-controlled-reply:${messageId}`,
      actionUrl: `/app/inbox?leadId=${lead.id}`,
      entityType: 'lead',
      entityId: lead.id,
    });
  }
}

function replySubject(subject?: string | null) {
  const value = String(subject || '').trim().slice(0, 490);
  if (!value) return 'Follow-up';
  return /^re:/i.test(value) ? value : `Re: ${value}`;
}
