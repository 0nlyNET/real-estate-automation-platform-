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
import { UserRole } from '../../common/rbac';
import { OperationsService } from '../operations/operations.service';
import { operationalEvent } from '../../common/operational-log';
import { ClientOperationsService } from '../client-operations/client-operations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AiConversationControlService } from '../ai/ai-conversation-control.service';
import { MessageSafetyService } from './message-safety.service';

type ProviderConfig = {
  sendgrid?: {
    apiKey?: string;
    fromEmail?: string;
    fromName?: string;
    inboundAddress?: string;
    routingKey?: string | null;
  };
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
    private readonly messageSafety: MessageSafetyService,
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
      rows.map((row) => [
        row.provider,
        {
          ...(decryptIntegrationPayload(row.encryptedValue) || {}),
          routingKey: row.routingKey || null,
        },
      ]),
    );
    const sendgrid = values.get('sendgrid');
    const twilio = values.get('twilio');
    return {
      sendgrid:
        sendgrid?.connected && !sendgrid?.error ? sendgrid : undefined,
      twilio: twilio?.connected && !twilio?.error ? twilio : undefined,
    };
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
    const assignedOnly = ctx?.scope === 'mine' && Boolean(ctx.userId);
    const rows = await this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.lead', 'lead')
      .where('lead.tenantId = :tenantId', { tenantId })
      .andWhere(
        assignedOnly
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
      assignedToUserId: message.lead?.assignedToUserId || null,
      isAssignedToViewer:
        Boolean(ctx?.userId) && message.lead?.assignedToUserId === ctx?.userId,
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
    _ctx?: { userId?: string; role?: UserRole },
  ) {
    const tenantId = this.requireTenant(tenantIdRaw);
    const lead = await this.leadRepository.findOne({ where: { id: leadId, tenantId } });
    if (!lead) throw new ForbiddenException('Lead not found');
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
      subject: message.subject || null,
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
    const recovered = await this.recoverUncertainSubmissions(limit, opts?.leadId);
    const ids = await this.claimMessages(limit, opts?.leadId);
    for (const id of ids) {
      const message = await this.messageRepository.findOne({
        where: { id, lockedBy: this.workerId },
        relations: ['lead'],
      });
      if (!message) continue;
      await this.trySend(message);
    }
    return { claimed: ids.length, recovered };
  }

  private async recoverUncertainSubmissions(
    limit: number,
    leadId?: string,
  ): Promise<number> {
    const ids = await this.dataSource.transaction(
      async (manager): Promise<string[]> => {
        const rows: Array<{ id: string }> = await manager.query(
          `WITH candidates AS (
             SELECT id
             FROM messages
             WHERE direction = 'outbound'
               AND status = 'sending'
               AND provider_submission_started_at IS NOT NULL
               AND ($4::uuid IS NULL OR "leadId" = $4::uuid)
               AND (locked_at IS NULL OR locked_at < now() - ($1 * interval '1 second'))
             ORDER BY provider_submission_started_at ASC
             FOR UPDATE SKIP LOCKED
             LIMIT $2
           )
           UPDATE messages AS message
           SET locked_at = now(), locked_by = $3
           FROM candidates
           WHERE message.id = candidates.id
           RETURNING message.id`,
          [MESSAGE_LEASE_SECONDS, limit, this.workerId, leadId || null],
        );
        return rows.map((row) => row.id);
      },
    );
    for (const id of ids) {
      const message = await this.messageRepository.findOne({
        where: { id, lockedBy: this.workerId },
        relations: ['lead'],
      });
      if (!message) continue;
      await this.failPermanently(
        message,
        'PROVIDER_RESULT_UNKNOWN',
        'The provider request started, but RealtyTechAI did not receive a definitive result. The message was not retried to prevent duplicate delivery.',
      );
      if (message.authorship === 'ai' && message.lead) {
        await this.aiControl.markWaitingForHuman(
          message.lead.tenantId,
          message.lead.id,
          'An AI response has an unknown provider result. Check the conversation before replying personally to avoid a duplicate.',
          'high',
        );
      }
    }
    return ids.length;
  }

  private claimMessages(limit: number, leadId?: string): Promise<string[]> {
    return this.dataSource.transaction(async (manager) => {
      const rows: Array<{ id: string }> = await manager.query(
        `WITH candidates AS (
           SELECT id
           FROM messages
           WHERE direction = 'outbound'
             AND status IN ('created', 'queued', 'pending', 'scheduled', 'sending')
             AND (status <> 'sending' OR provider_submission_started_at IS NULL)
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
    try {
      const send = (): Promise<{
        providerMessageId?: string;
        providerStatus: string;
      }> =>
        message.channel === 'email'
          ? this.sendEmail(message)
          : this.sendSms(message);
      const sendAndPersistAcceptance = async () => {
        message.attemptCount = (message.attemptCount || 0) + 1;
        message.lastAttemptedAt = new Date();
        message.lastError = null as any;
        await this.messageRepository.save(message);
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
        if (!result.providerMessageId) {
          message.errorCode = 'PROVIDER_ID_MISSING';
          message.sanitizedErrorMessage =
            'The provider accepted the request without returning a message identifier. Delivery tracking may be incomplete.';
          await this.messageRepository.save(message);
          await this.operations.createTask({
            tenantId: lead.tenantId,
            category: 'messaging_failure',
            title: `${message.channel.toUpperCase()} provider ID is missing`,
            description: message.sanitizedErrorMessage,
            priority: 'high',
            relatedEntityType: 'message',
            relatedEntityId: message.id,
            dedupeOpen: true,
          });
        }
        lead.lastContactedAt = acceptedAt;
        lead.lastActivityAt = acceptedAt;
        if (!lead.firstContactSentAt) lead.firstContactSentAt = acceptedAt;
        await this.leadRepository.save(lead);
        return result;
      };
      const submitted = await this.withTenantDispatchLock(
        lead.tenantId,
        async () => {
          const current = await this.messageRepository.findOne({
            where: {
              id: message.id,
              lockedBy: this.workerId,
              status: 'sending',
            },
            relations: ['lead'],
          });
          if (!current?.lead || current.lead.tenantId !== lead.tenantId) {
            return false;
          }
          const safety = await this.messageSafety.evaluateMessageSafety({
            leadId: lead.id,
            clientId: lead.tenantId,
            jobId: message.id,
            communicationType: message.communicationType || message.channel,
            requiresBookingLink: message.requiresBookingLink === true,
          });
          if (!safety.allowed) return false;

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
              return false;
            }
          } else {
            await sendAndPersistAcceptance();
          }
          return true;
        },
      );
      if (!submitted) return;
      await this.logLeadEvent(lead, 'message_provider_accepted', {
        channel: message.channel,
        messageId: message.id,
        providerMessageId: message.providerMessageId,
      });
    } catch (error: any) {
      const raw = String(error?.message || error || 'Provider request failed');
      const sanitized = sanitizeProviderError(raw);
      const definitiveRejection = isDefinitiveProviderRejection(error);
      if (
        definitiveRejection &&
        isTransientProviderError(error) &&
        message.attemptCount < MAX_SEND_ATTEMPTS
      ) {
        const delayMinutes = [1, 5, 15][message.attemptCount - 1] || 15;
        message.status = 'queued';
        message.errorCode = 'TRANSIENT_PROVIDER_ERROR';
        message.lastError = sanitized;
        message.sanitizedErrorMessage = sanitized;
        message.nextAttemptAt = new Date(Date.now() + delayMinutes * 60_000);
        message.providerSubmissionStartedAt = null;
        message.lockedAt = null;
        message.lockedBy = null;
        await this.messageRepository.save(message);
        return;
      }
      const uncertain = isUncertainProviderResult(error, raw);
      const code = uncertain
        ? 'PROVIDER_RESULT_UNKNOWN'
        : message.authorship === 'ai'
          ? 'AI_PROVIDER_SEND_FAILED'
          : 'PROVIDER_SEND_FAILED';
      const reason = uncertain
        ? 'The provider request may have been accepted, but its result could not be confirmed. RealtyTechAI did not retry it to prevent duplicate delivery.'
        : sanitized;
      await this.failPermanently(message, code, reason);
      if (message.authorship === 'ai') {
        await this.aiControl.markWaitingForHuman(
          lead.tenantId,
          lead.id,
          uncertain
            ? 'The AI response provider result is unknown. Check the conversation before responding personally to avoid a duplicate.'
            : 'The AI response provider failed. Review the inbound message and respond personally.',
          'high',
        );
      }
    }
  }

  private async withTenantDispatchLock<T>(
    tenantId: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    const lockName = `service-control:${tenantId}`;
    let locked = false;
    try {
      await queryRunner.query('SELECT pg_advisory_lock(hashtext($1))', [
        lockName,
      ]);
      locked = true;
      return await callback();
    } finally {
      if (locked) {
        await queryRunner
          .query('SELECT pg_advisory_unlock(hashtext($1))', [lockName])
          .catch(() => undefined);
      }
      await queryRunner.release();
    }
  }

  private async sendEmail(message: Message) {
    const lead = message.lead;
    const config = await this.getProviderConfig(lead.tenantId);
    const apiKey = config.sendgrid?.apiKey;
    const fromEmail = config.sendgrid?.fromEmail;
    const replyTo = normalizeEmail(config.sendgrid?.inboundAddress);
    if (!lead.email) throw new Error('Missing lead email');
    if (!apiKey || !fromEmail) throw new Error('Missing SendGrid credentials');
    if (!replyTo) {
      throw new Error('Missing valid SendGrid inbound reply address');
    }
    if (normalizeEmail(config.sendgrid?.routingKey || undefined) !== replyTo) {
      throw new Error('SendGrid inbound routing key does not match Reply-To');
    }
    const configuredFromName = String(config.sendgrid?.fromName || '').trim();
    const tenant = configuredFromName
      ? null
      : await this.tenantRepository.findOne({ where: { id: lead.tenantId } });
    const fromName = configuredFromName || String(tenant?.name || '').trim();
    if (!fromName) throw new Error('Missing tenant email sender name');
    const token = this.complianceService.createUnsubscribeToken(lead.tenantId, lead.id, lead.email);
    const appUrl = String(process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
    if (!appUrl) throw new Error('Missing FRONTEND_URL for email unsubscribe links');
    const unsubscribeUrl = `${appUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
    if (!/\{\{\s*unsubscribeUrl\s*\}\}/i.test(message.body)) {
      throw new Error('Approved email template is missing unsubscribe placeholder');
    }
    const text = message.body.replace(/\{\{\s*unsubscribeUrl\s*\}\}/gi, unsubscribeUrl);
    await this.markProviderSubmissionStarted(message);
    const response = await sendSendGridEmail({
      apiKey,
      to: lead.email,
      fromEmail,
      fromName,
      replyTo,
      subject: message.subject || `Follow-up from ${fromName}`,
      text,
      customArgs: { rta_message_id: message.id },
      ...(message.inReplyToProviderMessageId
        ? {
            headers: {
              'In-Reply-To': emailMessageIdHeader(
                message.inReplyToProviderMessageId,
              ),
              References: emailMessageIdHeader(
                message.inReplyToProviderMessageId,
              ),
            },
          }
        : {}),
    });
    return {
      providerMessageId: response.messageId
        ? `sendgrid:${response.messageId}`
        : undefined,
      providerStatus: response.status,
    };
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
    await this.markProviderSubmissionStarted(message);
    const response = await sendTwilioSms({
      accountSid,
      authToken,
      to: `+${String(lead.phone).replace(/^\+/, '')}`,
      body: message.body,
      statusCallback,
      ...(messagingServiceSid ? { messagingServiceSid } : { from: from as string }),
    });
    return { providerMessageId: response.sid, providerStatus: response.status || 'accepted' };
  }

  private async markProviderSubmissionStarted(message: Message) {
    message.providerSubmissionStartedAt = new Date();
    await this.messageRepository.save(message);
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

  async createMessage(data: Partial<Message>) {
    const message = this.messageRepository.create({
      ...data,
      leadId: data.leadId || data.lead?.id,
      communicationType: data.communicationType || data.channel || 'sms',
      requiresBookingLink: data.requiresBookingLink === true,
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

function isTransientProviderError(error: any) {
  const status = Number(error?.status || error?.statusCode || 0);
  return status === 408 || status === 429 || status >= 500;
}

function isDefinitiveProviderRejection(error: any) {
  return (
    error?.definitiveRejection === true ||
    Number(error?.status || error?.statusCode || 0) > 0
  );
}

function isUncertainProviderResult(error: any, message: string) {
  if (isDefinitiveProviderRejection(error)) return false;
  return /abort|timeout|timed out|network|fetch failed|ECONN|EAI_AGAIN|socket/i.test(
    message,
  );
}

function sanitizeProviderError(message: string) {
  return String(message || 'Provider request failed')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [redacted]')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, 'Basic [redacted]')
    .slice(0, 1_000);
}

function normalizeEmail(value?: string) {
  const raw = String(value || '').trim().toLowerCase();
  const match = raw.match(/<([^>]+)>/);
  const email = (match?.[1] || raw).trim();
  return email.includes('@') ? email : null;
}

function emailMessageIdHeader(providerMessageId: string) {
  const value = String(providerMessageId || '')
    .replace(/^sendgrid:/, '')
    .replace(/[<>\r\n]/g, '')
    .trim()
    .slice(0, 450);
  return `<${value}>`;
}
