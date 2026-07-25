import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { Message } from './message.entity';
import { Lead } from '../leads/lead.entity';
import { Tenant } from '../tenants/tenant.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { SequencesService } from '../sequences/sequences.service';
import { Credential } from '../settings/credential.entity';
import { decryptIntegrationPayload } from '../integrations/integrations.service';
import { ComplianceService } from '../compliance/compliance.service';
import { sendSendGridEmail, sendTwilioSms } from '../../common/providers';
import { UserRole, hasAtLeastRole } from '../../common/rbac';
import { EntitlementService } from '../entitlements/entitlement.service';
import { OperationsService } from '../operations/operations.service';
import { operationalEvent } from '../../common/operational-log';
import { ClientOperationsService } from '../client-operations/client-operations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AiConversationControlService } from '../ai/ai-conversation-control.service';
import { nextAllowedSendTime } from '../../common/time';

type ProviderConfig = {
  sendgrid?: { apiKey?: string; fromEmail?: string; fromName?: string };
  twilio?: {
    accountSid?: string;
    authToken?: string;
    fromNumber?: string;
    messagingServiceSid?: string;
  };
};

const MESSAGE_LEASE_SECONDS = 120;
const MAX_SEND_ATTEMPTS = 3;

@Injectable()
export class MessagingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private readonly workerId = `message-${process.env.HOSTNAME || process.pid}`;
  private senderTimer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(LeadEvent)
    private readonly leadEventRepository: Repository<LeadEvent>,
    @InjectRepository(Credential)
    private readonly credentialRepository: Repository<Credential>,
    private readonly sequencesService: SequencesService,
    private readonly complianceService: ComplianceService,
    private readonly entitlements: EntitlementService,
    private readonly operations: OperationsService,
    private readonly aiControl: AiConversationControlService,
    @Optional() private readonly clientOperations?: ClientOperationsService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.senderTimer = setInterval(() => {
      this.processPendingOutbound({ limit: 25 }).catch((error) =>
        this.logger.error(
          operationalEvent('message_worker_failed', {
            workerId: this.workerId,
            error: error?.message ?? error,
          }),
        ),
      );
    }, 5_000);
  }

  onModuleDestroy(): void {
    if (this.senderTimer) clearInterval(this.senderTimer);
  }

  private requireTenant(tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('Missing tenant');
    return tenantId;
  }

  private async getProviderConfig(tenantId: string): Promise<ProviderConfig> {
    const rows = await this.credentialRepository.find({
      where: { tenant: { id: tenantId } as any },
      relations: ['tenant'],
    });
    const values = new Map(
      rows.map((row) => [row.provider, decryptIntegrationPayload(row.encryptedValue)]),
    );
    const sendgrid = values.get('sendgrid');
    const twilio = values.get('twilio');
    return {
      sendgrid: sendgrid?.connected ? sendgrid : undefined,
      twilio: twilio?.connected ? twilio : undefined,
    };
  }

  async handleTwilioSmsWebhook(req: any) {
    return this.handleInboundSms(req?.body || {});
  }

  async handleSendgridInboundWebhook(req: any) {
    const body = req?.body || {};
    return this.handleInboundEmail({
      from: body.from || body.From || body.sender,
      text: body.text || body.Text || body.email || body.body || body.Body || '',
      subject: body.subject || body.Subject || '',
    });
  }

  async process(body: any) {
    const result = await this.processPendingOutbound({
      limit: body?.limit ? Number(body.limit) : 25,
      leadId: body?.leadId ? String(body.leadId) : undefined,
    });
    return { status: 'ok', ...result };
  }

  async listThreads(
    tenantIdRaw: string,
    take = 50,
    skip = 0,
    ctx?: { userId?: string; role?: UserRole; scope?: 'shared' | 'mine' },
  ) {
    const tenantId = this.requireTenant(tenantIdRaw);
    const canSeeAll = ctx?.role ? hasAtLeastRole(ctx.role, 'admin') : true;
    const rows = await this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.lead', 'lead')
      .where('lead.tenantId = :tenantId', { tenantId })
      .andWhere(
        (!canSeeAll || ctx?.scope === 'mine') && ctx?.userId
          ? 'lead.assignedToUserId = :userId'
          : '1=1',
        { userId: ctx?.userId },
      )
      .distinctOn(['lead.id'])
      .orderBy('lead.id', 'ASC')
      .addOrderBy('message.createdAt', 'DESC')
      .take(Math.min(Math.max(take, 1), 200))
      .skip(Math.max(skip, 0))
      .getMany();
    return rows.map((message) => ({
      leadId: message.lead?.id || null,
      leadName: message.lead?.fullName || null,
      leadEmail: message.lead?.email || null,
      leadPhone: message.lead?.phone || null,
      lastMessageId: message.id,
      lastMessageAt: message.createdAt,
      lastMessageBody: message.body,
      channel: message.channel,
      direction: message.direction,
      status: message.status,
      providerStatus: message.providerStatus || null,
      sequenceStatus: message.lead?.sequenceStatus || 'idle',
      temperature: message.lead?.temperature || 'warm',
      temperatureReason: message.lead?.temperatureReason || null,
      readiness: message.lead?.readinessLevel || 'exploring',
      blocker: message.lead?.mainBlocker || null,
      conversationSummary: message.lead?.conversationSummary || null,
      talkingPoints: message.lead?.recommendedTalkingPoints || [],
    }));
  }

  async getThreadMessages(
    tenantIdRaw: string,
    leadId: string,
    ctx?: { userId?: string; role?: UserRole },
  ) {
    const tenantId = this.requireTenant(tenantIdRaw);
    const lead = await this.leadRepository.findOne({ where: { id: leadId, tenantId } });
    if (!lead) throw new ForbiddenException('Lead not found');
    const canSeeAll = ctx?.role ? hasAtLeastRole(ctx.role, 'admin') : false;
    if (!canSeeAll && lead.assignedToUserId !== ctx?.userId) {
      throw new ForbiddenException('Lead is not assigned to this user');
    }
    const messages = await this.messageRepository.find({
      where: { leadId },
      order: { createdAt: 'ASC' },
    });
    return messages.map((message) => ({
      id: message.id,
      leadId: message.leadId,
      channel: message.channel,
      direction: message.direction,
      body: message.body,
      status: message.status,
      providerStatus: message.providerStatus || null,
      errorCode: message.errorCode || null,
      errorMessage: message.sanitizedErrorMessage || null,
      authorship: message.authorship || 'system',
      aiRunId: message.aiRunId || null,
      approvedAt: message.approvedAt || null,
      editedAt: message.editedAt || null,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    }));
  }

  /**
   * Immediate contact is intentionally handled by an approved zero-offset sequence.
   * This compatibility hook does not create an unapproved hard-coded message.
   */
  async queueInstantResponses(lead: Lead): Promise<void> {
    await this.logLeadEvent(lead, 'instant_response_delegated_to_approved_sequence', {
      reason: 'Only client-approved templates may send automatically',
    });
  }

  async processPendingOutbound(opts?: { limit?: number; leadId?: string }) {
    const limit = Math.min(Math.max(opts?.limit || 25, 1), 100);
    const ids = await this.claimMessages(limit, opts?.leadId);
    for (const id of ids) {
      const message = await this.messageRepository.findOne({
        where: { id, lockedBy: this.workerId },
        relations: ['lead'],
      });
      if (!message) continue;
      await this.trySend(message);
    }
    return { claimed: ids.length };
  }

  private claimMessages(limit: number, leadId?: string): Promise<string[]> {
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{ id: string }> = await manager.query(
        `WITH candidates AS (
           SELECT id
           FROM messages
           WHERE direction = 'outbound'
             AND status IN ('created', 'queued', 'pending', 'scheduled', 'sending')
             AND ($4::uuid IS NULL OR "leadId" = $4::uuid)
             AND (scheduled_at IS NULL OR scheduled_at <= now())
             AND (next_attempt_at IS NULL OR next_attempt_at <= now())
             AND (locked_at IS NULL OR locked_at < now() - ($1 * interval '1 second'))
           ORDER BY created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         UPDATE messages AS message
         SET status = 'sending', locked_at = now(), locked_by = $3
         FROM candidates
         WHERE message.id = candidates.id
         RETURNING message.id`,
        [MESSAGE_LEASE_SECONDS, limit, this.workerId, leadId || null],
      );
      return rows.map((row) => row.id);
    });
  }

  private async trySend(message: Message) {
    const lead = message.lead;
    if (!lead) {
      await this.failPermanently(message, 'MISSING_LEAD', 'Message has no lead');
      return;
    }
    const automated = message.authorship === 'ai' || message.authorship === 'template';
    const action = automated
      ? message.channel === 'sms'
        ? 'send_automated_sms'
        : 'send_automated_email'
      : message.channel === 'sms'
        ? 'send_manual_sms'
        : 'send_manual_email';
    const entitlement = await this.entitlements.evaluate(lead.tenantId, action);
    if (!entitlement.allowed) {
      await this.skipMessage(message, 'SERVICE_NOT_ENTITLED', entitlement.reasons.join('; '));
      return;
    }
    const consent = await this.complianceService.communicationEligibility(
      lead.tenantId,
      lead,
      message.channel,
    );
    if (!consent.allowed) {
      await this.skipMessage(
        message,
        consent.code || 'MISSING_CONSENT',
        consent.reason || 'Consent check failed',
      );
      return;
    }
    if (message.authorship === 'ai') {
      const quiet = await this.complianceService.getQuietHours(lead.tenantId);
      if (quiet.enabled) {
        const now = new Date();
        const next = nextAllowedSendTime({
          now,
          timeZone: quiet.timezone,
          quietStart: `${String(Math.floor(quiet.startMinute / 60)).padStart(2, '0')}:${String(quiet.startMinute % 60).padStart(2, '0')}`,
          quietEnd: `${String(Math.floor(quiet.endMinute / 60)).padStart(2, '0')}:${String(quiet.endMinute % 60).padStart(2, '0')}`,
        });
        if (next > now) {
          message.status = 'queued';
          message.scheduledAt = next;
          message.lockedAt = null;
          message.lockedBy = null;
          await this.messageRepository.save(message);
          return;
        }
      }
    }

    message.attemptCount = (message.attemptCount || 0) + 1;
    message.lastAttemptedAt = new Date();
    message.lastError = null as any;
    try {
      const send = (): Promise<{
        providerMessageId?: string;
        providerStatus: string;
      }> =>
        message.channel === 'email'
          ? this.sendEmail(message)
          : this.sendSms(message);
      const sendAndPersistAcceptance = async () => {
        const result = await send();
        const acceptedAt = new Date();
        message.providerMessageId =
          result.providerMessageId || message.providerMessageId;
        message.providerStatus = result.providerStatus || 'accepted';
        message.status = 'provider_accepted';
        message.providerAcceptedAt = acceptedAt;
        message.lockedAt = null;
        message.lockedBy = null;
        message.nextAttemptAt = null;
        await this.messageRepository.save(message);
        lead.lastContactedAt = acceptedAt;
        lead.lastActivityAt = acceptedAt;
        if (!lead.firstContactSentAt) lead.firstContactSentAt = acceptedAt;
        await this.leadRepository.save(lead);
        return result;
      };
      if (message.authorship === 'ai') {
        const exclusive = await this.aiControl.runAiSendExclusive(
          lead.tenantId,
          lead.id,
          message.id,
          sendAndPersistAcceptance,
        );
        if (!exclusive.allowed) {
          await this.skipMessage(
            message,
            'AI_CONTROL_CHANGED',
            exclusive.reason,
          );
          return;
        }
      } else {
        await sendAndPersistAcceptance();
      }
      await this.logLeadEvent(lead, 'message_provider_accepted', {
        channel: message.channel,
        messageId: message.id,
        providerMessageId: message.providerMessageId,
      });
    } catch (error: any) {
      const raw = String(error?.message || error || 'Provider request failed');
      const sanitized = sanitizeProviderError(raw);
      if (message.authorship === 'ai') {
        await this.failPermanently(
          message,
          'AI_PROVIDER_SEND_FAILED',
          sanitized,
        );
        await this.aiControl.markWaitingForHuman(
          lead.tenantId,
          lead.id,
          'The AI response provider failed. Review the inbound message and respond personally.',
          'high',
        );
        return;
      }
      if (isTransientProviderError(error, raw) && message.attemptCount < MAX_SEND_ATTEMPTS) {
        const delayMinutes = [1, 5, 15][message.attemptCount - 1] || 15;
        message.status = 'queued';
        message.errorCode = 'TRANSIENT_PROVIDER_ERROR';
        message.lastError = sanitized;
        message.sanitizedErrorMessage = sanitized;
        message.nextAttemptAt = new Date(Date.now() + delayMinutes * 60_000);
        message.lockedAt = null;
        message.lockedBy = null;
        await this.messageRepository.save(message);
        return;
      }
      await this.failPermanently(message, 'PROVIDER_SEND_FAILED', sanitized);
    }
  }

  private async sendEmail(message: Message) {
    const lead = message.lead;
    const config = await this.getProviderConfig(lead.tenantId);
    const apiKey = config.sendgrid?.apiKey;
    const fromEmail = config.sendgrid?.fromEmail;
    if (!lead.email) throw new Error('Missing lead email');
    if (!apiKey || !fromEmail) throw new Error('Missing SendGrid credentials');
    const token = this.complianceService.createUnsubscribeToken(lead.tenantId, lead.id, lead.email);
    const appUrl = String(process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
    if (!appUrl) throw new Error('Missing FRONTEND_URL for email unsubscribe links');
    const unsubscribeUrl = `${appUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
    if (!/\{\{\s*unsubscribeUrl\s*\}\}/i.test(message.body)) {
      throw new Error('Approved email template is missing unsubscribe placeholder');
    }
    const text = message.body.replace(/\{\{\s*unsubscribeUrl\s*\}\}/gi, unsubscribeUrl);
    await sendSendGridEmail({
      apiKey,
      to: lead.email,
      fromEmail,
      fromName: config.sendgrid?.fromName || 'RealtyTechAI',
      subject: 'Follow-up',
      text,
    });
    return { providerStatus: 'accepted' };
  }

  private async sendSms(message: Message) {
    const lead = message.lead;
    const config = await this.getProviderConfig(lead.tenantId);
    const accountSid = config.twilio?.accountSid;
    const authToken = config.twilio?.authToken;
    const from = config.twilio?.fromNumber;
    const messagingServiceSid = config.twilio?.messagingServiceSid;
    if (!lead.phone) throw new Error('Missing lead phone');
    if (!accountSid || !authToken) throw new Error('Missing Twilio credentials');
    if (!from && !messagingServiceSid) throw new Error('Missing Twilio sender configuration');
    const statusCallback = String(process.env.TWILIO_STATUS_CALLBACK_URL || '').trim();
    if (!statusCallback) throw new Error('Missing TWILIO_STATUS_CALLBACK_URL');
    const response = await sendTwilioSms({
      accountSid,
      authToken,
      to: `+${String(lead.phone).replace(/^\+/, '')}`,
      body: message.body,
      statusCallback,
      ...(messagingServiceSid ? { messagingServiceSid } : { from: from as string }),
    });
    if (!response.sid) throw new Error('Twilio accepted the request without a message SID');
    return { providerMessageId: response.sid, providerStatus: response.status || 'accepted' };
  }

  private async skipMessage(message: Message, code: string, reason: string) {
    message.status = 'skipped';
    message.errorCode = code;
    message.lastError = reason;
    message.sanitizedErrorMessage = reason;
    message.lockedAt = null;
    message.lockedBy = null;
    message.nextAttemptAt = null;
    await this.messageRepository.save(message);
    this.logger.warn(
      operationalEvent('message_skipped', {
        tenantId: message.lead?.tenantId || null,
        messageId: message.id,
        channel: message.channel,
        attemptCount: message.attemptCount,
        errorCode: code,
        error: reason,
      }),
    );
    if (message.lead) {
      await this.logLeadEvent(message.lead, 'message_skipped', {
        messageId: message.id,
        channel: message.channel,
        code,
        reason,
      });
    }
  }

  private async failPermanently(message: Message, code: string, reason: string) {
    message.status = 'failed';
    message.failedAt = new Date();
    message.errorCode = code;
    message.lastError = reason;
    message.sanitizedErrorMessage = reason;
    message.lockedAt = null;
    message.lockedBy = null;
    message.nextAttemptAt = null;
    await this.messageRepository.save(message);
    if (message.lead) {
      await this.logLeadEvent(message.lead, 'message_failed', {
        messageId: message.id,
        channel: message.channel,
        code,
      });
      await this.operations.createTask({
        tenantId: message.lead.tenantId,
        category: 'messaging_failure',
        title: `${message.channel.toUpperCase()} message failed`,
        description: reason,
        priority: 'high',
        relatedEntityType: 'message',
        relatedEntityId: message.id,
        dedupeOpen: true,
      });
      await this.notifications?.createForTenant({
        tenantId: message.lead.tenantId,
        assignedUserId: message.lead.assignedToUserId,
        eventType: 'message.failed',
        category: 'leads',
        severity: 'warning',
        title: `A message to ${message.lead.fullName} did not send`,
        message: 'Open the conversation and try again or contact the lead another way.',
        deduplicationKey: `message-failed:${message.id}`,
        actionUrl: `/app/inbox?leadId=${message.lead.id}`,
        entityType: 'message',
        entityId: message.id,
      });
    }
  }

  async handleInboundSms(payload: { From?: string; Body?: string }) {
    const from = normalizePhone(payload.From);
    if (!from) return { status: 'ignored' } as const;
    const lead = await this.leadRepository.findOne({
      where: { phone: from },
      relations: ['tenant'],
      order: { createdAt: 'DESC' },
    });
    if (!lead) return { status: 'no_lead' } as const;
    const inbound = await this.createMessage({
      lead,
      leadId: lead.id,
      channel: 'sms',
      direction: 'inbound',
      body: payload.Body || '',
      status: 'received',
      providerStatus: 'received',
    });
    await this.markReply(lead, inbound, 'sms');
    return { status: 'ok' } as const;
  }

  async handleInboundEmail(payload: { from?: string; text?: string; subject?: string }) {
    const from = normalizeEmail(payload.from);
    if (!from) return { status: 'ignored' } as const;
    const lead = await this.leadRepository.findOne({
      where: { email: from },
      relations: ['tenant'],
      order: { createdAt: 'DESC' },
    });
    if (!lead) return { status: 'no_lead' } as const;
    const inbound = await this.createMessage({
      lead,
      leadId: lead.id,
      channel: 'email',
      direction: 'inbound',
      body: payload.text || '',
      status: 'received',
      providerStatus: 'received',
    });
    await this.markReply(lead, inbound, 'email', payload.subject);
    return { status: 'ok' } as const;
  }

  private async markReply(lead: Lead, message: Message, channel: string, subject?: string) {
    const now = new Date();
    if (!lead.firstResponseReceivedAt) {
      lead.firstResponseReceivedAt = now;
      if (lead.firstContactSentAt) {
        lead.firstResponseTimeSec = Math.max(
          0,
          Math.floor((now.getTime() - lead.firstContactSentAt.getTime()) / 1000),
        );
      }
    }
    lead.lastActivityAt = now;
    lead.sequenceStatus = 'stopped';
    await this.leadRepository.save(lead);
    await this.logLeadEvent(lead, 'lead_replied', {
      channel,
      messageId: message.id,
      subject,
    });
    await this.sequencesService.stopForLead(lead.id, 'reply');
    try {
      await this.clientOperations?.processInboundReply(lead, message.body, message.id);
    } catch (error: any) {
      this.logger.error(
        operationalEvent('lead_qualification_failed', {
          tenantId: lead.tenantId,
          leadId: lead.id,
          messageId: message.id,
          error: error?.message || String(error),
        }),
      );
    }
  }

  async createMessage(data: Partial<Message>) {
    const message = this.messageRepository.create({
      ...data,
      leadId: data.leadId || data.lead?.id,
      idempotencyKey: data.idempotencyKey || `message:${randomUUID()}`,
    });
    return this.messageRepository.save(message);
  }

  async getMessagesForLead(leadId: string) {
    return this.messageRepository.find({ where: { leadId }, order: { createdAt: 'DESC' } });
  }

  private async logLeadEvent(lead: Lead, eventType: string, metadata?: Record<string, any>) {
    try {
      await this.leadEventRepository.save(
        this.leadEventRepository.create({ lead, leadId: lead.id, eventType, metadata } as any),
      );
    } catch (error: any) {
      this.logger.error(`Could not record ${eventType}: ${error?.message ?? error}`);
    }
  }
}

function isTransientProviderError(error: any, message: string) {
  const status = Number(error?.status || error?.statusCode || 0);
  return (
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    /timeout|timed out|network|ECONN|EAI_AGAIN|HTTP (408|429|5\d\d)/i.test(message)
  );
}

function sanitizeProviderError(message: string) {
  return String(message || 'Provider request failed')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [redacted]')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [redacted]')
    .slice(0, 1_000);
}

function normalizePhone(value?: string) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `1${digits}`;
  return digits || null;
}

function normalizeEmail(value?: string) {
  const raw = String(value || '').trim().toLowerCase();
  const match = raw.match(/<([^>]+)>/);
  const email = (match?.[1] || raw).trim();
  return email.includes('@') ? email : null;
}
