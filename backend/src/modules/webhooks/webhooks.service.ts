import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import * as crypto from 'crypto';

import { normalizePhoneDigits, normalizePhoneE164 } from '../../common/phone';
import { Credential } from '../settings/credential.entity';
import { Lead } from '../leads/lead.entity';
import { LeadEvent } from '../leads/lead-event.entity';
import { Message } from '../messaging/message.entity';
import { decryptIntegrationPayload } from '../integrations/integrations.service';
import { ComplianceService } from '../compliance/compliance.service';
import { SequencesService } from '../sequences/sequences.service';
import { LeadsService } from '../leads/leads.service';
import { OperationsService } from '../operations/operations.service';
import {
  operationalEvent,
  sanitizeOperationalText,
} from '../../common/operational-log';
import { AiConversationService } from '../ai/ai-conversation.service';

export type TwilioInboundBody = Record<string, unknown> & {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
  SmsSid?: string;
};

export type TwilioStatusBody = Record<string, unknown> & {
  MessageSid?: string;
  SmsSid?: string;
  MessageStatus?: string;
  SmsStatus?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
};

export function validTwilioSignature(
  url: string,
  params: Record<string, unknown>,
  authToken: string,
  supplied: string,
) {
  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((key) => `${key}${String(params[key] ?? '')}`)
      .join('');
  const expected = crypto
    .createHmac('sha1', authToken)
    .update(payload)
    .digest('base64');
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied || '');
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

type PersistedInbound = {
  duplicate: boolean;
  tenantId?: string;
  leadId?: string;
  messageId?: string;
  channel?: 'sms' | 'email';
  stopKeyword?: boolean;
};

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Credential)
    private readonly credentialsRepo: Repository<Credential>,
    private readonly compliance: ComplianceService,
    private readonly sequences: SequencesService,
    private readonly leads: LeadsService,
    private readonly aiConversations: AiConversationService,
    @Optional()
    @InjectRepository(Message)
    private readonly messagesRepo?: Repository<Message>,
    @Optional()
    private readonly operations?: OperationsService,
  ) {}

  async handleTwilioStatus(
    body: TwilioStatusBody,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const providerMessageId = String(body.MessageSid || body.SmsSid || '').trim();
    const providerStatus = String(body.MessageStatus || body.SmsStatus || '')
      .trim()
      .toLowerCase();
    if (!providerMessageId || !providerStatus) {
      throw new BadRequestException('Missing required Twilio status fields');
    }
    if (!this.messagesRepo) throw new Error('Message repository is unavailable');
    const message = await this.messagesRepo.findOne({
      where: { providerMessageId },
      relations: ['lead'],
    });
    if (!message?.lead?.tenantId) return { status: 'ignored' } as const;
    const credential = await this.credentialsRepo.findOne({
      where: {
        provider: 'twilio',
        tenant: { id: message.lead.tenantId } as any,
      },
      relations: ['tenant'],
    });
    const integration = credential
      ? decryptIntegrationPayload(credential.encryptedValue)
      : null;
    const authToken = String(integration?.authToken || '').trim();
    const callbackUrl = String(process.env.TWILIO_STATUS_CALLBACK_URL || '').trim();
    const signatureHeader = headers['x-twilio-signature'];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0] || ''
      : String(signatureHeader || '');
    if (
      !integration?.connected ||
      !authToken ||
      !callbackUrl ||
      !validTwilioSignature(callbackUrl, body, authToken, signature)
    ) {
      this.logger.warn(
        operationalEvent('invalid_webhook_signature', {
          provider: 'twilio',
          webhook: 'status',
          providerMessageId,
        }),
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const currentRank = messageStatusRank(message.status);
    const next = twilioMessageState(providerStatus);
    if (next && next.rank >= currentRank) {
      const now = new Date();
      message.providerStatus = providerStatus;
      message.status = next.status;
      if (next.status === 'sent') message.sentAt = message.sentAt || now;
      if (next.status === 'delivered') {
        message.sentAt = message.sentAt || now;
        message.deliveredAt = message.deliveredAt || now;
      }
      if (next.status === 'failed') {
        message.failedAt = message.failedAt || now;
        message.errorCode = String(body.ErrorCode || 'TWILIO_DELIVERY_FAILED');
        message.sanitizedErrorMessage = sanitizeOperationalText(
          body.ErrorMessage || `Twilio reported ${providerStatus}`,
        );
      }
      if (next.status === 'canceled') message.canceledAt = message.canceledAt || now;
      await this.messagesRepo.save(message);
      if (next.status === 'failed' && this.operations) {
        this.logger.warn(
          operationalEvent('provider_delivery_failed', {
            provider: 'twilio',
            tenantId: message.lead.tenantId,
            messageId: message.id,
            providerMessageId,
            providerStatus,
            errorCode: message.errorCode,
          }),
        );
        await this.operations.createTask({
          tenantId: message.lead.tenantId,
          category: 'messaging_failure',
          title: 'Twilio delivery failed',
          description: message.sanitizedErrorMessage || providerStatus,
          priority: 'high',
          relatedEntityType: 'message',
          relatedEntityId: message.id,
          dedupeOpen: true,
        });
      }
    }
    return { status: 'ok', messageStatus: message.status } as const;
  }

  verifyFacebookWebhook(
    mode: string | undefined,
    verifyToken: string | undefined,
    challenge: string | undefined,
  ) {
    const expected = String(
      process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || '',
    ).trim();
    if (
      mode !== 'subscribe' ||
      !expected ||
      !verifyToken ||
      !challenge ||
      !safeEqual(expected, verifyToken)
    ) {
      this.logger.warn(
        operationalEvent('invalid_webhook_verification', {
          provider: 'facebook',
          webhook: 'lead_ads',
        }),
      );
      throw new UnauthorizedException('Facebook webhook verification failed');
    }
    return challenge;
  }

  async handleFacebookLeadAds(
    body: any,
    rawBody: Buffer | undefined,
    signature: string,
  ) {
    this.verifyFacebookSignature(rawBody, signature);
    const changes = Array.isArray(body?.entry)
      ? body.entry.flatMap((entry: any) =>
          Array.isArray(entry?.changes)
            ? entry.changes.map((change: any) => ({ entry, change }))
            : [],
        )
      : [];

    let processed = 0;
    for (const { entry, change } of changes) {
      if (change?.field !== 'leadgen') continue;
      const pageId = String(change?.value?.page_id || entry?.id || '').trim();
      const leadgenId = String(change?.value?.leadgen_id || '').trim();
      if (!pageId || !leadgenId) continue;
      await this.ingestFacebookLead(pageId, leadgenId, change?.value);
      processed += 1;
    }
    return { received: true, processed };
  }

  private verifyFacebookSignature(
    rawBody: Buffer | undefined,
    supplied: string,
  ) {
    const secret = String(process.env.FACEBOOK_APP_SECRET || '').trim();
    if (!secret || !rawBody || !supplied.startsWith('sha256=')) {
      this.logger.warn(
        operationalEvent('invalid_webhook_signature', {
          provider: 'facebook',
          webhook: 'lead_ads',
        }),
      );
      throw new UnauthorizedException('Invalid Facebook webhook signature');
    }
    const expected = `sha256=${crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;
    if (!safeEqual(expected, supplied)) {
      this.logger.warn(
        operationalEvent('invalid_webhook_signature', {
          provider: 'facebook',
          webhook: 'lead_ads',
        }),
      );
      throw new UnauthorizedException('Invalid Facebook webhook signature');
    }
  }

  private async ingestFacebookLead(
    pageId: string,
    leadgenId: string,
    webhookValue: Record<string, unknown>,
  ) {
    const credential = await this.credentialsRepo.findOne({
      where: { provider: 'facebook_lead_ads', routingKey: pageId },
      relations: ['tenant'],
    });
    const integration = credential
      ? decryptIntegrationPayload(credential.encryptedValue)
      : null;
    if (!credential?.tenant?.id || !integration?.connected) {
      throw new BadRequestException(
        'Facebook Page is not connected to a workspace',
      );
    }
    const accessToken = String(integration.pageAccessToken || '').trim();
    if (!accessToken) {
      throw new BadRequestException('Facebook Page access token is missing');
    }

    const version = String(
      process.env.FACEBOOK_GRAPH_API_VERSION || 'v19.0',
    ).trim();
    if (!/^v\d+\.\d+$/.test(version)) {
      throw new BadRequestException('FACEBOOK_GRAPH_API_VERSION is invalid');
    }
    const url = new URL(
      `https://graph.facebook.com/${version}/${encodeURIComponent(leadgenId)}`,
    );
    url.searchParams.set(
      'fields',
      'id,created_time,field_data,form_id,ad_id,ad_name,campaign_id,campaign_name',
    );
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new BadRequestException(
        payload?.error?.message ||
          `Facebook lead retrieval failed (${response.status})`,
      );
    }

    const fields = facebookFieldMap(payload?.field_data);
    const fullName =
      fields.full_name ||
      [fields.first_name, fields.last_name].filter(Boolean).join(' ') ||
      fields.email ||
      fields.phone_number ||
      'Facebook lead';
    await this.leads.intake(credential.tenant.id, {
      fullName,
      email: fields.email || undefined,
      phone: fields.phone_number || undefined,
      source: 'Facebook Lead Ads',
      message: fields.message || fields.comments || undefined,
      location: fields.city || fields.location || undefined,
      propertyInterest:
        fields.property_interest || fields.property_type || undefined,
      leadType: normalizeFacebookLeadType(fields.lead_type),
      temperature: 'warm',
      score: 65,
    } as any);

    this.logger.log(
      operationalEvent('facebook_lead_saved', {
        tenantId: credential.tenant.id,
        providerLeadId: leadgenId,
      }),
    );
    void webhookValue;
  }

  private async findTwilioCredential(
    routingKey: string,
  ): Promise<Credential | null> {
    const direct = await this.credentialsRepo.findOne({
      where: { provider: 'twilio', routingKey },
      relations: ['tenant'],
    });
    if (direct) return direct;

    // Existing encrypted rows predate routing keys. Backfill the one exact
    // match once, then all subsequent webhooks use the indexed lookup.
    const legacy = await this.credentialsRepo.find({
      where: { provider: 'twilio', routingKey: IsNull() },
      relations: ['tenant'],
    });
    const matches = legacy.filter((row) => {
      const payload = decryptIntegrationPayload(row.encryptedValue);
      return (
        Boolean(payload?.connected) &&
        normalizePhoneE164(payload?.fromNumber) === routingKey
      );
    });
    if (matches.length !== 1) return null;

    matches[0].routingKey = routingKey;
    try {
      return await this.credentialsRepo.save(matches[0]);
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      return this.credentialsRepo.findOne({
        where: { provider: 'twilio', routingKey },
        relations: ['tenant'],
      });
    }
  }

  async handleTwilioInbound(
    body: TwilioInboundBody,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const from = normalizePhoneDigits(String(body.From || ''));
    const toRoutingKey = normalizePhoneE164(String(body.To || ''));
    const text = String(body.Body ?? '');
    const providerMessageId = String(
      body.MessageSid || body.SmsSid || '',
    ).trim();

    if (!from || !toRoutingKey || !providerMessageId) {
      throw new BadRequestException('Missing required Twilio message fields');
    }

    const credential = await this.findTwilioCredential(toRoutingKey);
    if (!credential?.tenant?.id) {
      this.logger.warn(
        operationalEvent('twilio_inbound_unrouted', {
          providerMessageId,
        }),
      );
      return { status: 'ignored' } as const;
    }

    const integration = decryptIntegrationPayload(credential.encryptedValue);
    const authToken = String(integration?.authToken || '');
    const signatureHeader = headers['x-twilio-signature'];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0] || ''
      : String(signatureHeader || '');
    const webhookUrl = String(process.env.TWILIO_WEBHOOK_URL || '').trim();
    if (
      !integration?.connected ||
      !authToken ||
      !webhookUrl ||
      !validTwilioSignature(webhookUrl, body, authToken, signature)
    ) {
      this.logger.warn(
        operationalEvent('invalid_webhook_signature', {
          provider: 'twilio',
          webhook: 'inbound',
          tenantId: credential.tenant.id,
          providerMessageId,
        }),
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const tenantId = credential.tenant.id;
    const stopKeyword = this.compliance.isStopKeyword(text);
    const persisted = await this.dataSource.transaction((manager) =>
      this.persistInbound(manager, {
        tenantId,
        from,
        text,
        providerMessageId,
        stopKeyword,
      }),
    );

    if (!persisted.leadId) return { status: 'ignored' } as const;

    if (stopKeyword) {
      await this.compliance.addOptOut(
        tenantId,
        'sms',
        from,
        'stop_keyword',
        'twilio_webhook',
      );
    }
    await this.sequences.stopForLead(
      persisted.leadId,
      stopKeyword ? 'opt_out' : 'reply',
    );
    if (!persisted.duplicate && persisted.messageId) {
      await this.queueAiSafely({
        tenantId,
        leadId: persisted.leadId,
        messageId: persisted.messageId,
        channel: 'sms',
      });
    }

    this.logger.log(
      operationalEvent('twilio_inbound_saved', {
        tenantId,
        leadId: persisted.leadId,
        providerMessageId,
        stopKeyword,
        duplicate: persisted.duplicate,
      }),
    );
    return {
      status: persisted.duplicate ? 'duplicate' : 'ok',
    } as const;
  }

  async handleSendGridInbound(body: Record<string, unknown>, authorization: string) {
    this.verifySendGridAuthorization(authorization);
    const from = extractEmailAddress(body.from);
    const to = extractSendGridRecipient(body);
    const rawMessageId = extractEmailMessageId(body);
    const text = String(body.text || '').trim();
    const subject = String(body.subject || '').trim().slice(0, 500);
    if (!from || !to || !rawMessageId) {
      throw new BadRequestException(
        'Missing required SendGrid inbound message fields',
      );
    }
    const credential = await this.findSendGridCredential(to);
    if (!credential?.tenant?.id) {
      this.logger.warn(
        operationalEvent('sendgrid_inbound_unrouted', {
          providerMessageId: rawMessageId,
        }),
      );
      return { status: 'ignored' } as const;
    }
    const integration = decryptIntegrationPayload(credential.encryptedValue);
    if (!integration?.connected || integration?.error) {
      throw new UnauthorizedException('SendGrid integration is not ready');
    }
    const tenantId = credential.tenant.id;
    const stopKeyword =
      this.compliance.isStopKeyword(text) ||
      /^\s*(?:unsubscribe|remove me|opt out)\s*[.!]?\s*$/i.test(text);
    const providerMessageId = `sendgrid:${rawMessageId}`.slice(0, 500);
    const persisted = await this.dataSource.transaction((manager) =>
      this.persistEmailInbound(manager, {
        tenantId,
        from,
        text: [subject ? `Subject: ${subject}` : '', text]
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 100_000),
        providerMessageId,
        stopKeyword,
      }),
    );
    if (!persisted.leadId) return { status: 'ignored' } as const;
    if (stopKeyword) {
      await this.compliance.addOptOut(
        tenantId,
        'email',
        from,
        'unsubscribe_request',
        'sendgrid_inbound_webhook',
      );
    }
    await this.sequences.stopForLead(
      persisted.leadId,
      stopKeyword ? 'opt_out' : 'reply',
    );
    if (!persisted.duplicate && persisted.messageId) {
      await this.queueAiSafely({
        tenantId,
        leadId: persisted.leadId,
        messageId: persisted.messageId,
        channel: 'email',
      });
    }
    this.logger.log(
      operationalEvent('sendgrid_inbound_saved', {
        tenantId,
        leadId: persisted.leadId,
        providerMessageId,
        stopKeyword,
        duplicate: persisted.duplicate,
      }),
    );
    return {
      status: persisted.duplicate ? 'duplicate' : 'ok',
    } as const;
  }

  private async persistInbound(
    manager: EntityManager,
    input: {
      tenantId: string;
      from: string;
      text: string;
      providerMessageId: string;
      stopKeyword: boolean;
    },
  ): Promise<PersistedInbound> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `twilio:${input.providerMessageId}`,
    ]);

    const messageRepository = manager.getRepository(Message);
    const leadRepository = manager.getRepository(Lead);
    const leadEventRepository = manager.getRepository(LeadEvent);
    const duplicate = await messageRepository.findOne({
      where: { providerMessageId: input.providerMessageId },
      relations: ['lead'],
    });
    if (duplicate) {
      return {
        duplicate: true,
        tenantId: input.tenantId,
        leadId: duplicate.leadId || duplicate.lead?.id,
        messageId: duplicate.id,
        channel: 'sms',
        stopKeyword: input.stopKeyword,
      };
    }

    let lead = await leadRepository.findOne({
      where: { tenantId: input.tenantId, phone: input.from },
    });
    if (!lead) {
      lead = leadRepository.create({
        tenantId: input.tenantId,
        fullName: input.from,
        phone: input.from,
        source: 'twilio',
        stage: 'new',
        score: 50,
        leadType: 'buyer',
        temperature: 'warm',
        sequenceStatus: 'idle',
      });
      lead = await leadRepository.save(lead);
    }

    const receivedAt = new Date();
    const message = await messageRepository.save(
      messageRepository.create({
        lead,
        leadId: lead.id,
        channel: 'sms',
        direction: 'inbound',
        body: input.text,
        providerMessageId: input.providerMessageId,
        status: 'received',
        providerStatus: 'received',
        sentAt: receivedAt,
        attemptCount: 0,
      }),
    );

    if (!lead.firstResponseReceivedAt) {
      lead.firstResponseReceivedAt = receivedAt;
      if (lead.firstContactSentAt) {
        lead.firstResponseTimeSec = Math.max(
          0,
          Math.floor(
            (receivedAt.getTime() - lead.firstContactSentAt.getTime()) / 1000,
          ),
        );
      }
    }
    lead.lastActivityAt = receivedAt;
    lead.nextFollowUpAt = undefined;
    lead.sequenceStatus = 'stopped';
    await leadRepository.save(lead);

    await leadEventRepository.save(
      leadEventRepository.create({
        lead,
        eventType: input.stopKeyword ? 'sms_opt_out_received' : 'lead_replied',
        metadata: {
          channel: 'sms',
          messageId: message.id,
          providerMessageId: input.providerMessageId,
        },
      }),
    );

    return {
      duplicate: false,
      tenantId: input.tenantId,
      leadId: lead.id,
      messageId: message.id,
      channel: 'sms',
      stopKeyword: input.stopKeyword,
    };
  }

  private async findSendGridCredential(
    routingKey: string,
  ): Promise<Credential | null> {
    const direct = await this.credentialsRepo.findOne({
      where: { provider: 'sendgrid', routingKey },
      relations: ['tenant'],
    });
    if (direct) return direct;
    const legacy = await this.credentialsRepo.find({
      where: { provider: 'sendgrid', routingKey: IsNull() },
      relations: ['tenant'],
    });
    const matches = legacy.filter((row) => {
      const payload = decryptIntegrationPayload(row.encryptedValue);
      return (
        Boolean(payload?.connected) &&
        extractEmailAddress(payload?.inboundAddress) === routingKey
      );
    });
    if (matches.length !== 1) return null;
    matches[0].routingKey = routingKey;
    try {
      return await this.credentialsRepo.save(matches[0]);
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      return this.credentialsRepo.findOne({
        where: { provider: 'sendgrid', routingKey },
        relations: ['tenant'],
      });
    }
  }

  private verifySendGridAuthorization(authorization: string) {
    const expectedUser = String(
      process.env.SENDGRID_INBOUND_USERNAME || '',
    ).trim();
    const expectedPassword = String(
      process.env.SENDGRID_INBOUND_PASSWORD || '',
    );
    const encoded = authorization.startsWith('Basic ')
      ? authorization.slice(6).trim()
      : '';
    let supplied = '';
    try {
      supplied = Buffer.from(encoded, 'base64').toString('utf8');
    } catch {
      supplied = '';
    }
    const expected = `${expectedUser}:${expectedPassword}`;
    if (
      !expectedUser ||
      !expectedPassword ||
      !encoded ||
      !safeEqual(expected, supplied)
    ) {
      this.logger.warn(
        operationalEvent('invalid_webhook_signature', {
          provider: 'sendgrid',
          webhook: 'inbound',
        }),
      );
      throw new UnauthorizedException('Invalid SendGrid webhook authorization');
    }
  }

  private async persistEmailInbound(
    manager: EntityManager,
    input: {
      tenantId: string;
      from: string;
      text: string;
      providerMessageId: string;
      stopKeyword: boolean;
    },
  ): Promise<PersistedInbound> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      input.providerMessageId,
    ]);
    const messageRepository = manager.getRepository(Message);
    const leadRepository = manager.getRepository(Lead);
    const leadEventRepository = manager.getRepository(LeadEvent);
    const duplicate = await messageRepository.findOne({
      where: { providerMessageId: input.providerMessageId },
      relations: ['lead'],
    });
    if (duplicate) {
      return {
        duplicate: true,
        tenantId: input.tenantId,
        leadId: duplicate.leadId || duplicate.lead?.id,
        messageId: duplicate.id,
        channel: 'email',
        stopKeyword: input.stopKeyword,
      };
    }
    let lead = await leadRepository.findOne({
      where: { tenantId: input.tenantId, email: input.from },
    });
    if (!lead) {
      lead = await leadRepository.save(
        leadRepository.create({
          tenantId: input.tenantId,
          fullName: input.from,
          email: input.from,
          source: 'sendgrid',
          stage: 'new',
          score: 50,
          leadType: 'buyer',
          temperature: 'warm',
          sequenceStatus: 'idle',
        }),
      );
    }
    const receivedAt = new Date();
    const message = await messageRepository.save(
      messageRepository.create({
        lead,
        leadId: lead.id,
        channel: 'email',
        direction: 'inbound',
        body: input.text || '(No plain-text message body)',
        providerMessageId: input.providerMessageId,
        status: 'received',
        providerStatus: 'received',
        sentAt: receivedAt,
        attemptCount: 0,
      }),
    );
    if (!lead.firstResponseReceivedAt) {
      lead.firstResponseReceivedAt = receivedAt;
      if (lead.firstContactSentAt) {
        lead.firstResponseTimeSec = Math.max(
          0,
          Math.floor(
            (receivedAt.getTime() - lead.firstContactSentAt.getTime()) / 1_000,
          ),
        );
      }
    }
    lead.lastActivityAt = receivedAt;
    lead.nextFollowUpAt = undefined;
    lead.sequenceStatus = 'stopped';
    await leadRepository.save(lead);
    await leadEventRepository.save(
      leadEventRepository.create({
        lead,
        eventType: input.stopKeyword
          ? 'email_opt_out_received'
          : 'lead_replied',
        metadata: {
          channel: 'email',
          messageId: message.id,
          providerMessageId: input.providerMessageId,
        },
      }),
    );
    return {
      duplicate: false,
      tenantId: input.tenantId,
      leadId: lead.id,
      messageId: message.id,
      channel: 'email',
      stopKeyword: input.stopKeyword,
    };
  }

  private async queueAiSafely(event: {
    tenantId: string;
    leadId: string;
    messageId: string;
    channel: 'sms' | 'email';
  }) {
    try {
      await this.aiConversations.acceptInbound(event);
    } catch (error: unknown) {
      const reason = sanitizeOperationalText(
        error instanceof Error ? error.message : String(error),
      ).slice(0, 500);
      this.logger.error(
        operationalEvent('ai_inbound_queue_failed', {
          tenantId: event.tenantId,
          leadId: event.leadId,
          messageId: event.messageId,
          error: reason,
        }),
      );
      await this.operations?.createTask({
        tenantId: event.tenantId,
        category: 'ai_provider_failure',
        title: 'Inbound reply needs human follow-up',
        description:
          'The inbound message was stored, but AI processing could not be queued.',
        priority: 'high',
        relatedEntityType: 'message',
        relatedEntityId: event.messageId,
        dedupeOpen: true,
      });
    }
  }
}

function safeEqual(expected: string, supplied: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function extractEmailAddress(value: unknown) {
  const text = String(value || '').trim().toLowerCase();
  const bracketed = text.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  const candidate = (bracketed?.[1] || text).replace(/^mailto:/, '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : '';
}

function extractSendGridRecipient(body: Record<string, unknown>) {
  try {
    const envelope =
      typeof body.envelope === 'string'
        ? JSON.parse(body.envelope)
        : body.envelope;
    if (Array.isArray(envelope?.to)) {
      const first = envelope.to
        .map((item: unknown) => extractEmailAddress(item))
        .find(Boolean);
      if (first) return first;
    }
  } catch {
    // Fall through to SendGrid's top-level `to` field.
  }
  return extractEmailAddress(body.to);
}

function extractEmailMessageId(body: Record<string, unknown>) {
  const direct = String(
    body['message-id'] || body.messageId || body.MessageId || '',
  ).trim();
  if (direct) return direct.replace(/[<>\s]/g, '').slice(0, 450);
  const headers = String(body.headers || '');
  const match = headers.match(/^message-id:\s*(.+)$/im);
  return String(match?.[1] || '')
    .trim()
    .replace(/[<>\s]/g, '')
    .slice(0, 450);
}

function twilioMessageState(status: string): { status: Message['status']; rank: number } | null {
  if (['accepted', 'queued', 'sending'].includes(status)) {
    return { status: 'provider_accepted', rank: 2 };
  }
  if (status === 'sent') return { status: 'sent', rank: 3 };
  if (status === 'delivered') return { status: 'delivered', rank: 5 };
  if (['failed', 'undelivered'].includes(status)) return { status: 'failed', rank: 4 };
  if (status === 'canceled') return { status: 'canceled', rank: 4 };
  return null;
}

function messageStatusRank(status: Message['status']) {
  if (status === 'delivered') return 5;
  if (status === 'failed' || status === 'canceled') return 4;
  if (status === 'sent') return 3;
  if (status === 'provider_accepted') return 2;
  return 1;
}

function facebookFieldMap(fieldData: unknown) {
  const result: Record<string, string> = {};
  if (!Array.isArray(fieldData)) return result;
  for (const item of fieldData) {
    const name = String(item?.name || '')
      .trim()
      .toLowerCase();
    const values = Array.isArray(item?.values) ? item.values : [];
    if (name && values.length) result[name] = String(values[0]);
  }
  return result;
}

function normalizeFacebookLeadType(value?: string) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return ['buyer', 'seller', 'renter', 'investor'].includes(normalized)
    ? (normalized as 'buyer' | 'seller' | 'renter' | 'investor')
    : 'buyer';
}
