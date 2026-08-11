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
import { validateRequest as validateTwilioRequest } from 'twilio/lib/webhooks/webhooks';

import { normalizePhoneDigits, normalizePhoneE164 } from '../../common/phone';
import { isOptOutMessage, normalizeOptOutBody } from '../../common/opt-out';
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
import { TwilioInboundMessage } from './twilio-inbound-message.entity';
import { ComplianceOptOut } from '../compliance/compliance-optout.entity';
import { LeadConsentRecord } from '../compliance/lead-consent-record.entity';
import { ComplianceEvent } from '../compliance/compliance-event.entity';
import { SendGridWebhookEvent } from './sendgrid-webhook-event.entity';
import { OnboardingService } from '../onboarding/onboarding.service';
import { TenantMessagingResource } from '../integrations/tenant-messaging-resource.entity';
import { TenantEmailIdentity } from '../integrations/tenant-email-identity.entity';
import { decryptString } from '../../common/crypto-secrets';
import { LimitsService } from '../limits/limits.service';
import { Tenant } from '../tenants/tenant.entity';
import { assertLeadAcceptance } from '../leads/lead-acceptance';

export type TwilioInboundBody = Record<string, unknown> & {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
  SmsSid?: string;
  MessagingServiceSid?: string;
  OptOutType?: string;
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
  const stringParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null)
      stringParams[key] = String(value);
  }
  return validateTwilioRequest(authToken, supplied, url, stringParams);
}

type PersistedInbound = {
  duplicate: boolean;
  tenantId?: string;
  leadId?: string;
  messageId?: string;
  channel?: 'sms' | 'email';
  stopKeyword?: boolean;
  processingResult?:
    | 'reply_recorded'
    | 'opt_out_applied'
    | 'lead_not_found'
    | 'ambiguous_lead';
  canceledJobs?: number;
  inboundEventId?: string;
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
    @Optional()
    private readonly onboarding?: OnboardingService,
    @Optional()
    @InjectRepository(TenantMessagingResource)
    private readonly messagingResources?: Repository<TenantMessagingResource>,
    @Optional()
    @InjectRepository(TenantEmailIdentity)
    private readonly emailIdentities?: Repository<TenantEmailIdentity>,
    @Optional()
    private readonly limits?: LimitsService,
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
    const route = await this.findTwilioRoute('', null, message.lead.tenantId);
    const authToken = String(route?.authToken || '').trim();
    const callbackUrl = String(process.env.TWILIO_STATUS_CALLBACK_URL || '').trim();
    const signatureHeader = headers['x-twilio-signature'];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0] || ''
      : String(signatureHeader || '');
    if (
      !route?.connected ||
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
      if (next.status === 'failed' || next.status === 'delivered') {
        await this.recordReadinessEvidenceSafely(message.lead.tenantId, {
          ...(next.status === 'failed' ? { providerRejection: true } : {}),
          ...(next.status === 'delivered' ? { outboundDelivered: true } : {}),
          ...(message.lead.testRunId
            ? { testRunId: message.lead.testRunId }
            : {}),
        });
      }
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

  private async findTwilioRoute(
    routingKey: string,
    messagingServiceSid?: string | null,
    tenantId?: string,
  ): Promise<{ tenantId: string; authToken: string; connected: boolean } | null> {
    if (this.messagingResources) {
      let resource = tenantId
        ? await this.messagingResources.findOne({ where: { tenantId } })
        : routingKey
          ? await this.messagingResources.findOne({ where: { phoneNumber: routingKey } })
          : null;
      if (!resource && messagingServiceSid) {
        resource = await this.messagingResources.findOne({
          where: { messagingServiceSid },
        });
      }
      if (resource?.encryptedAuthToken) {
        return {
          tenantId: resource.tenantId,
          authToken: decryptString(resource.encryptedAuthToken),
          connected: !['failed'].includes(resource.smsStatus),
        };
      }
    }
    const direct = await this.credentialsRepo.findOne({
      where: tenantId
        ? ({ provider: 'twilio', tenant: { id: tenantId } as any } as any)
        : { provider: 'twilio', routingKey },
      relations: ['tenant'],
    });
    if (direct) {
      const payload = decryptIntegrationPayload(direct.encryptedValue);
      return {
        tenantId: direct.tenant.id,
        authToken: String(payload?.authToken || ''),
        connected: Boolean(payload?.connected && !payload?.error),
      };
    }

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
        (normalizePhoneE164(payload?.fromNumber) === routingKey ||
          (messagingServiceSid &&
            String(payload?.messagingServiceSid || '').trim() ===
              messagingServiceSid))
      );
    });
    if (matches.length !== 1) return null;

    matches[0].routingKey = routingKey;
    try {
      const saved = await this.credentialsRepo.save(matches[0]);
      const payload = decryptIntegrationPayload(saved.encryptedValue);
      return {
        tenantId: saved.tenant.id,
        authToken: String(payload?.authToken || ''),
        connected: Boolean(payload?.connected && !payload?.error),
      };
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      const saved = await this.credentialsRepo.findOne({
        where: { provider: 'twilio', routingKey },
        relations: ['tenant'],
      });
      if (!saved) return null;
      const payload = decryptIntegrationPayload(saved.encryptedValue);
      return {
        tenantId: saved.tenant.id,
        authToken: String(payload?.authToken || ''),
        connected: Boolean(payload?.connected && !payload?.error),
      };
    }
  }

  async handleTwilioInbound(
    body: TwilioInboundBody,
    headers: Record<string, string | string[] | undefined>,
  ) {
    const fromE164 = normalizePhoneE164(String(body.From || ''));
    const fromDigits = normalizePhoneDigits(String(body.From || ''));
    const toRoutingKey = normalizePhoneE164(String(body.To || ''));
    const text = String(body.Body ?? '');
    const providerMessageId = String(
      body.MessageSid || body.SmsSid || '',
    ).trim();
    const messagingServiceSid = String(body.MessagingServiceSid || '').trim();
    const optOutType = String(body.OptOutType || '').trim() || null;

    if (!fromE164 || !fromDigits || !toRoutingKey || !providerMessageId) {
      throw new BadRequestException('Missing required Twilio message fields');
    }

    const route = await this.findTwilioRoute(
      toRoutingKey,
      messagingServiceSid,
    );
    if (!route?.tenantId) {
      this.logger.warn(
        operationalEvent('twilio_inbound_unrouted', {
          providerMessageId,
        }),
      );
      return { status: 'ignored' } as const;
    }

    const authToken = route.authToken;
    const signatureHeader = headers['x-twilio-signature'];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0] || ''
      : String(signatureHeader || '');
    const webhookUrl = String(process.env.TWILIO_WEBHOOK_URL || '').trim();
    if (
      !route.connected ||
      !authToken ||
      !webhookUrl ||
      !validTwilioSignature(webhookUrl, body, authToken, signature)
    ) {
      await this.compliance
        .recordEvent(route.tenantId, {
          type: 'twilio_signature_rejected',
          channel: 'sms',
          payload: {
            providerMessageId,
            to: toRoutingKey,
          },
        })
        .catch(() => undefined);
      this.logger.warn(
        operationalEvent('invalid_webhook_signature', {
          provider: 'twilio',
          webhook: 'inbound',
          tenantId: route.tenantId,
          providerMessageId,
        }),
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const tenantId = route.tenantId;
    const stopKeyword = isOptOutMessage(text, optOutType);
    const persisted = await this.dataSource.transaction((manager) =>
      this.persistInbound(manager, {
        tenantId,
        fromE164,
        fromDigits,
        to: toRoutingKey,
        text,
        providerMessageId,
        messagingServiceSid: messagingServiceSid || null,
        optOutType,
        stopKeyword,
      }),
    );
    const effectiveStopKeyword = persisted.stopKeyword ?? stopKeyword;

    if (!persisted.leadId) {
      await this.operations?.createTask({
        tenantId,
        category: 'messaging_failure',
        title:
          persisted.processingResult === 'ambiguous_lead'
            ? 'Inbound SMS matched multiple leads'
            : 'Inbound SMS sender was not matched',
        description:
          persisted.processingResult === 'ambiguous_lead'
            ? 'An authenticated inbound SMS was stored for review but could not be attached because multiple workspace leads share the sender number.'
            : 'An authenticated inbound SMS was stored for review but no workspace lead matched the sender number.',
        priority: 'high',
        relatedEntityType: 'twilio_inbound_message',
        relatedEntityId:
          persisted.inboundEventId || deterministicUuid(providerMessageId),
        dedupeOpen: true,
      });
      return { status: 'ignored' } as const;
    }
    const readinessLead = typeof (this.leads as any).getLeadById === 'function'
      ? await this.leads.getLeadById(tenantId, persisted.leadId).catch(() => null)
      : null;
    if (!effectiveStopKeyword) {
      await this.sequences.stopForLead(tenantId, persisted.leadId, 'reply');
    }
    await this.recordReadinessEvidenceSafely(tenantId, {
      inboundSms: true,
      stop: effectiveStopKeyword,
      ...(readinessLead?.testRunId
        ? { testRunId: readinessLead.testRunId }
        : {}),
    });
    if (!effectiveStopKeyword && persisted.messageId) {
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
        stopKeyword: effectiveStopKeyword,
        duplicate: persisted.duplicate,
        processingResult: persisted.processingResult,
        canceledJobs: persisted.canceledJobs || 0,
      }),
    );
    return {
      status: persisted.duplicate
        ? 'duplicate'
        : effectiveStopKeyword
          ? 'opted_out'
          : 'ok',
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
    const route = await this.findSendGridRoute(to);
    if (!route?.tenantId) {
      this.logger.warn(
        operationalEvent('sendgrid_inbound_unrouted', {
          providerMessageId: rawMessageId,
        }),
      );
      return { status: 'ignored' } as const;
    }
    if (extractEmailAddress(route.inboundAddress) !== to) {
      this.logger.error(
        operationalEvent('sendgrid_inbound_route_mismatch', {
          tenantId: route.tenantId,
          providerMessageId: rawMessageId,
        }),
      );
      await this.operations?.createTask({
        tenantId: route.tenantId,
        category: 'messaging_failure',
        title: 'Inbound email routing needs attention',
        description:
          'An authenticated inbound email matched a stored routing key, but the tenant inbound address configuration did not match.',
        priority: 'high',
        relatedEntityType: 'integration:sendgrid',
        relatedEntityId: route.tenantId,
        dedupeOpen: true,
      });
      return { status: 'ignored' } as const;
    }
    if (!route.connected || route.error) {
      this.logger.warn(
        operationalEvent('sendgrid_inbound_outbound_unavailable', {
          tenantId: route.tenantId,
          providerMessageId: rawMessageId,
          connected: Boolean(route.connected),
          hasProviderError: Boolean(route.error),
        }),
      );
    }
    const tenantId = route.tenantId;
    if (this.limits) {
      const existingLead = await this.dataSource.getRepository(Lead).findOne({
        where: { tenantId, email: from },
      });
      if (!existingLead) {
        const usage = await this.limits.reserveUsage({
          tenantId,
          metric: 'lead',
          idempotencyKey: `lead-inbound-email:${crypto
            .createHash('sha256')
            .update(`${tenantId}:${from}`)
            .digest('hex')}`,
        });
        if (!usage.ok) {
          await this.operations?.createTask({
            tenantId,
            category: 'usage_limit',
            title: 'Inbound email lead blocked by usage limit',
            description: usage.message,
            priority: 'critical',
            relatedEntityType: 'tenant',
            relatedEntityId: tenantId,
            dedupeOpen: true,
          });
          return { status: 'ignored' } as const;
        }
      }
    }
    const stopKeyword =
      this.compliance.isStopKeyword(text) ||
      /^\s*(?:unsubscribe|remove me|opt out)\s*[.!]?\s*$/i.test(text);
    const providerMessageId = `sendgrid:${rawMessageId}`.slice(0, 500);
    const persisted = await this.dataSource.transaction((manager) =>
      this.persistEmailInbound(manager, {
        tenantId,
        from,
        subject,
        text: [subject ? `Subject: ${subject}` : '', text]
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 100_000),
        providerMessageId,
        stopKeyword,
      }),
    );
    if (!persisted.leadId) return { status: 'ignored' } as const;
    const readinessLead = typeof (this.leads as any).getLeadById === 'function'
      ? await this.leads.getLeadById(tenantId, persisted.leadId).catch(() => null)
      : null;
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
      tenantId,
      persisted.leadId,
      stopKeyword ? 'opt_out' : 'reply',
    );
    await this.recordReadinessEvidenceSafely(tenantId, {
      inboundEmail: true,
      ...(readinessLead?.testRunId
        ? { testRunId: readinessLead.testRunId }
        : {}),
    });
    if (!stopKeyword && persisted.messageId) {
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

  async handleSendGridEvents(body: unknown, authorization: string) {
    this.verifySendGridAuthorization(authorization);
    if (!Array.isArray(body) || body.length === 0 || body.length > 1_000) {
      throw new BadRequestException('SendGrid event payload must be a non-empty array');
    }
    let processed = 0;
    let duplicates = 0;
    let ignored = 0;
    for (const value of body) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException('SendGrid event payload contains an invalid event');
      }
      const result = await this.persistSendGridEvent(
        value as Record<string, unknown>,
      );
      if (result.status === 'duplicate') {
        duplicates += 1;
        continue;
      }
      if (result.status === 'ignored') ignored += 1;
      else processed += 1;

      if (result.deliveryFailed && result.message?.lead) {
        await this.recordReadinessEvidenceSafely(
          result.message.lead.tenantId,
          {
            providerRejection: true,
            testRunId: result.message.lead.testRunId,
          },
        );
      } else if (result.message?.lead?.testRunId) {
        await this.recordReadinessEvidenceSafely(
          result.message.lead.tenantId,
          {
            outboundDelivered: true,
            testRunId: result.message.lead.testRunId,
          },
        );
      }

      if (result.deliveryFailed && result.message?.lead && this.operations) {
        await this.operations.createTask({
          tenantId: result.message.lead.tenantId,
          category: 'messaging_failure',
          title: 'SendGrid delivery failed',
          description:
            result.message.sanitizedErrorMessage ||
            'SendGrid reported that the email could not be delivered.',
          priority: 'high',
          relatedEntityType: 'message',
          relatedEntityId: result.message.id,
          dedupeOpen: true,
        });
      }
      if (result.optOut && result.message?.lead?.email) {
        await this.compliance.addOptOut(
          result.message.lead.tenantId,
          'email',
          result.message.lead.email,
          'provider_unsubscribe_event',
          'sendgrid_event_webhook',
        );
        await this.sequences.stopForLead(
          result.message.lead.tenantId,
          result.message.lead.id,
          'opt_out',
        );
      }
      if (result.permanentSuppression && result.message?.lead?.email) {
        await this.compliance.addDeliverySuppression(
          result.message.lead.tenantId,
          'email',
          result.message.lead.email,
          result.permanentSuppression,
          'sendgrid_event_webhook',
        );
        await this.sequences.stopForLead(
          result.message.lead.tenantId,
          result.message.lead.id,
          'other',
        );
      }
      if (
        result.status === 'ignored' &&
        result.deliveryEvent &&
        this.operations
      ) {
        await this.operations.createTask({
          category: 'messaging_failure',
          title: 'Unmatched SendGrid delivery event',
          description:
            'An authenticated SendGrid delivery event could not be matched to an outbound RealtyTechAI message.',
          priority: 'high',
          relatedEntityType: 'sendgrid_webhook_event',
          relatedEntityId: result.eventId,
          dedupeOpen: true,
        });
      }
    }
    return { status: 'ok', processed, duplicates, ignored } as const;
  }

  private async persistSendGridEvent(event: Record<string, unknown>) {
    const eventType = String(event.event || '').trim().toLowerCase();
    const rawProviderMessageId = String(
      event.sg_message_id || event['smtp-id'] || '',
    )
      .trim()
      .replace(/[<>]/g, '')
      .slice(0, 450);
    if (!eventType) {
      throw new BadRequestException('SendGrid event type is required');
    }
    const customArgs =
      event.custom_args && typeof event.custom_args === 'object'
        ? (event.custom_args as Record<string, unknown>)
        : {};
    const uniqueArgs =
      event.unique_args && typeof event.unique_args === 'object'
        ? (event.unique_args as Record<string, unknown>)
        : {};
    const internalMessageId = validUuid(
      event.rta_message_id ||
        customArgs.rta_message_id ||
        uniqueArgs.rta_message_id,
    );
    const timestamp = Number(event.timestamp || 0);
    const providerEventId = String(event.sg_event_id || '').trim().slice(0, 255) ||
      crypto
        .createHash('sha256')
        .update(
          [eventType, rawProviderMessageId, internalMessageId || '', timestamp]
            .join(':'),
        )
        .digest('hex');
    const occurredAt =
      Number.isFinite(timestamp) && timestamp > 0
        ? new Date(timestamp * 1_000)
        : null;

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `sendgrid-event:${providerEventId}`,
      ]);
      const events = manager.getRepository(SendGridWebhookEvent);
      const existing = await events.findOne({ where: { providerEventId } });
      if (existing) {
        return {
          status: 'duplicate' as const,
          eventId: existing.id,
          deliveryEvent: isSendGridDeliveryEvent(eventType),
        };
      }
      const messages = manager.getRepository(Message);
      let message = internalMessageId
        ? await messages.findOne({
            where: { id: internalMessageId },
            relations: ['lead'],
          })
        : null;
      if (!message && rawProviderMessageId) {
        message = await messages.findOne({
          where: { providerMessageId: `sendgrid:${rawProviderMessageId}` },
          relations: ['lead'],
        });
      }
      if (!message && rawProviderMessageId) {
        const matches = await messages
          .createQueryBuilder('message')
          .leftJoinAndSelect('message.lead', 'lead')
          .where("message.provider_message_id LIKE 'sendgrid:%'")
          .andWhere(
            ":providerMessageId LIKE substring(message.provider_message_id from 10) || '%'",
            { providerMessageId: rawProviderMessageId },
          )
          .take(2)
          .getMany();
        if (matches.length === 1) message = matches[0];
      }
      if (
        message &&
        (message.channel !== 'email' || message.direction !== 'outbound')
      ) {
        message = null;
      }

      const providerMessageId = rawProviderMessageId
        ? `sendgrid:${rawProviderMessageId}`.slice(0, 500)
        : message?.providerMessageId || null;
      const savedEvent = await events.save(
        events.create({
          providerEventId,
          tenantId: message?.lead?.tenantId || null,
          messageId: message?.id || null,
          eventType,
          providerMessageId,
          occurredAt,
          processingResult: message ? 'updated' : 'ignored',
          payloadMetadata: {
            responseCode: safeProviderEventValue(event.response),
            attempt: safeProviderEventValue(event.attempt),
            tls: safeProviderEventValue(event.tls),
          },
        }),
      );
      if (!message) {
        this.logger.warn(
          operationalEvent('sendgrid_event_unmatched', {
            providerEventId,
            eventType,
          }),
        );
        return {
          status: 'ignored' as const,
          eventId: savedEvent.id,
          deliveryEvent: isSendGridDeliveryEvent(eventType),
        };
      }

      const state = sendGridMessageState(eventType);
      const currentRank = messageStatusRank(message.status);
      const now = occurredAt || new Date();
      message.providerStatus = eventType;
      if (!message.providerMessageId && providerMessageId) {
        message.providerMessageId = providerMessageId;
      }
      if (state && state.rank >= currentRank) {
        message.status = state.status;
        if (state.status === 'sent') message.sentAt = message.sentAt || now;
        if (state.status === 'delivered') {
          message.sentAt = message.sentAt || now;
          message.deliveredAt = message.deliveredAt || now;
        }
        if (state.status === 'failed') {
          message.failedAt = message.failedAt || now;
          message.errorCode = `SENDGRID_${eventType.toUpperCase()}`.slice(0, 80);
          message.sanitizedErrorMessage = sanitizeOperationalText(
            event.reason || event.response || `SendGrid reported ${eventType}`,
          ).slice(0, 1_000);
        }
      }
      await messages.save(message);
      const deliveryFailed = state?.status === 'failed';
      const disposition = classifySendGridDisposition(eventType, event);
      const optOut = disposition === 'consent_opt_out';
      const permanentSuppression =
        disposition === 'permanent_suppression'
          ? `sendgrid_${eventType}`
          : null;
      this.logger.log(
        operationalEvent('sendgrid_event_saved', {
          tenantId: message.lead?.tenantId || null,
          messageId: message.id,
          providerEventId,
          eventType,
          messageStatus: message.status,
        }),
      );
      return {
        status: 'updated' as const,
        eventId: savedEvent.id,
        message,
        deliveryFailed,
        optOut,
        permanentSuppression,
        deliveryEvent: isSendGridDeliveryEvent(eventType),
      };
    });
  }

  private async persistInbound(
    manager: EntityManager,
    input: {
      tenantId: string;
      fromE164: string;
      fromDigits: string;
      to: string;
      text: string;
      providerMessageId: string;
      messagingServiceSid: string | null;
      optOutType: string | null;
      stopKeyword: boolean;
    },
  ): Promise<PersistedInbound> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `twilio:${input.tenantId}:${input.providerMessageId}`,
    ]);
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `service-control:${input.tenantId}`,
    ]);

    const inboundRepository = manager.getRepository(TwilioInboundMessage);
    const messageRepository = manager.getRepository(Message);
    const leadRepository = manager.getRepository(Lead);
    const leadEventRepository = manager.getRepository(LeadEvent);
    const duplicateEvent = await inboundRepository.findOne({
      where: {
        tenantId: input.tenantId,
        messageSid: input.providerMessageId,
      },
    });
    if (duplicateEvent) {
      const duplicateMessage = duplicateEvent.leadId
        ? await messageRepository.findOne({
            where: { providerMessageId: input.providerMessageId },
          })
        : null;
      return {
        duplicate: true,
        tenantId: input.tenantId,
        leadId: duplicateEvent.leadId ?? undefined,
        messageId: duplicateMessage?.id,
        channel: 'sms',
        stopKeyword: duplicateEvent.isOptOut,
        processingResult: duplicateEvent.processingResult,
        canceledJobs: 0,
        inboundEventId: duplicateEvent.id,
      };
    }

    const legacyMessage = await messageRepository.findOne({
      where: { providerMessageId: input.providerMessageId },
      relations: ['lead'],
    });
    if (legacyMessage?.lead?.tenantId === input.tenantId) {
      const legacyEvent = await inboundRepository.save(
        inboundRepository.create({
          tenantId: input.tenantId,
          leadId: legacyMessage.leadId,
          messageSid: input.providerMessageId,
          messagingServiceSid: input.messagingServiceSid,
          fromNumber: input.fromE164,
          toNumber: input.to,
          body: input.text.slice(0, 10_000),
          normalizedBody: normalizeOptOutBody(input.text).slice(0, 10_000),
          optOutType: input.optOutType?.slice(0, 50) ?? null,
          isOptOut: input.stopKeyword,
          processingResult: input.stopKeyword
            ? 'opt_out_applied'
            : 'reply_recorded',
          processedAt: new Date(),
        }),
      );
      return {
        duplicate: true,
        tenantId: input.tenantId,
        leadId: legacyMessage.leadId,
        messageId: legacyMessage.id,
        channel: 'sms',
        stopKeyword: input.stopKeyword,
        processingResult: legacyEvent.processingResult,
        canceledJobs: 0,
        inboundEventId: legacyEvent.id,
      };
    }

    const candidates = await leadRepository
      .createQueryBuilder('lead')
      .where('lead.tenantId = :tenantId', { tenantId: input.tenantId })
      .andWhere('lead.phone IS NOT NULL')
      .andWhere("regexp_replace(lead.phone, '[^0-9]', '', 'g') = :fromDigits", {
        fromDigits: input.fromDigits,
      })
      .orderBy('lead.createdAt', 'ASC')
      .getMany();
    const receivedAt = new Date();
    if (candidates.length !== 1) {
      const processingResult =
        candidates.length === 0 ? 'lead_not_found' : 'ambiguous_lead';
      const event = await inboundRepository.save(
        inboundRepository.create({
          tenantId: input.tenantId,
          leadId: null,
          messageSid: input.providerMessageId,
          messagingServiceSid: input.messagingServiceSid,
          fromNumber: input.fromE164,
          toNumber: input.to,
          body: input.text.slice(0, 10_000),
          normalizedBody: normalizeOptOutBody(input.text).slice(0, 10_000),
          optOutType: input.optOutType?.slice(0, 50) ?? null,
          isOptOut: input.stopKeyword,
          processingResult,
          processedAt: receivedAt,
        }),
      );
      await manager.getRepository(ComplianceEvent).save(
        manager.getRepository(ComplianceEvent).create({
          tenantId: input.tenantId,
          type:
            processingResult === 'ambiguous_lead'
              ? 'twilio_inbound_ambiguous_lead'
              : 'twilio_inbound_lead_not_found',
          channel: 'sms',
          leadId: null,
          userId: null,
          messageId: null,
          to: input.fromE164,
          payload: {
            messageSid: input.providerMessageId,
            candidateCount: candidates.length,
            inboundEventId: event.id,
          },
        }),
      );
      return {
        duplicate: false,
        tenantId: input.tenantId,
        channel: 'sms',
        stopKeyword: input.stopKeyword,
        processingResult,
        canceledJobs: 0,
        inboundEventId: event.id,
      };
    }

    const lead = await leadRepository.findOne({
      where: { id: candidates[0].id, tenantId: input.tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!lead)
      throw new Error(
        'Tenant-scoped lead disappeared during inbound processing',
      );

    const message = await messageRepository.save(
      messageRepository.create({
        lead,
        leadId: lead.id,
        channel: 'sms',
        direction: 'inbound',
        body: input.text.slice(0, 10_000),
        providerMessageId: input.providerMessageId,
        status: 'received',
        providerStatus: 'received',
        sentAt: receivedAt,
        attemptCount: 0,
        communicationType: 'sms',
        requiresBookingLink: false,
        jobPurpose: 'ordinary',
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
    let canceledJobs = 0;
    if (input.stopKeyword) {
      lead.communicationStatus = 'opted_out';
      lead.optedOutAt = lead.optedOutAt || receivedAt;
      lead.optOutSource = 'twilio_inbound_sms';

      const optOutRepository = manager.getRepository(ComplianceOptOut);
      const existingOptOut = await optOutRepository.findOne({
        where: {
          tenantId: input.tenantId,
          channel: 'sms',
          value: input.fromDigits,
        },
      });
      if (!existingOptOut) {
        await optOutRepository.save(
          optOutRepository.create({
            tenantId: input.tenantId,
            channel: 'sms',
            value: input.fromDigits,
            reason: 'stop_keyword',
            source: 'twilio_inbound_sms',
          }),
        );
      }

      await manager.getRepository(LeadConsentRecord).update(
        {
          tenantId: input.tenantId,
          leadId: lead.id,
          channel: 'sms',
        },
        {
          status: 'revoked',
          revokedAt: receivedAt,
          revocationSource: 'twilio_inbound_sms',
        },
      );
      const canceled: Array<{ id: string }> = await manager.query(
        `UPDATE messages
         SET status = 'canceled',
             canceled_at = $3,
             cancellation_reason = 'Cancelled by inbound SMS opt-out',
             error_code = 'CANCELLED_BY_OPT_OUT',
             sanitized_error_message = 'Cancelled after recipient SMS opt-out',
             last_error = 'Cancelled after recipient SMS opt-out',
             locked_at = NULL,
             locked_by = NULL,
             next_attempt_at = NULL
         WHERE "leadId" = $1
           AND direction = 'outbound'
           AND status IN ('created', 'queued', 'pending', 'scheduled', 'sending')
           AND (status <> 'sending' OR provider_submission_started_at IS NULL)
           AND EXISTS (
             SELECT 1 FROM leads
             WHERE leads.id = messages."leadId"
               AND leads.tenant_id = $2
           )
         RETURNING id`,
        [lead.id, input.tenantId, receivedAt],
      );
      canceledJobs = canceled.length;
      await manager.query(
        `UPDATE sequence_enrollments
         SET status = 'stopped',
             stopped_reason = 'opt_out',
             next_run_at = NULL,
             locked_at = NULL,
             locked_by = NULL
         WHERE tenant_id = $1
           AND "leadId" = $2
           AND status IN ('active', 'paused')`,
        [input.tenantId, lead.id],
      );
    }
    await leadRepository.save(lead);

    const processingResult = input.stopKeyword
      ? 'opt_out_applied'
      : 'reply_recorded';
    const inboundEvent = await inboundRepository.save(
      inboundRepository.create({
        tenantId: input.tenantId,
        leadId: lead.id,
        messageSid: input.providerMessageId,
        messagingServiceSid: input.messagingServiceSid,
        fromNumber: input.fromE164,
        toNumber: input.to,
        body: input.text.slice(0, 10_000),
        normalizedBody: normalizeOptOutBody(input.text).slice(0, 10_000),
        optOutType: input.optOutType?.slice(0, 50) ?? null,
        isOptOut: input.stopKeyword,
        processingResult,
        processedAt: receivedAt,
      }),
    );

    await leadEventRepository.save(
      leadEventRepository.create({
        lead,
        eventType: input.stopKeyword ? 'sms_opt_out_received' : 'lead_replied',
        metadata: {
          channel: 'sms',
          messageId: message.id,
          providerMessageId: input.providerMessageId,
          inboundEventId: inboundEvent.id,
          canceledJobs,
        },
      }),
    );

    if (input.stopKeyword) {
      await manager.getRepository(ComplianceEvent).save(
        manager.getRepository(ComplianceEvent).create({
          tenantId: input.tenantId,
          type: 'sms_opt_out_recorded',
          channel: 'sms',
          leadId: lead.id,
          userId: null,
          messageId: message.id,
          to: input.fromE164,
          payload: {
            source: 'twilio_inbound_sms',
            messageSid: input.providerMessageId,
            optOutType: input.optOutType,
            canceledJobs,
          },
        }),
      );
    }

    return {
      duplicate: false,
      tenantId: input.tenantId,
      leadId: lead.id,
      messageId: message.id,
      channel: 'sms',
      stopKeyword: input.stopKeyword,
      processingResult,
      canceledJobs,
      inboundEventId: inboundEvent.id,
    };
  }

  private async findSendGridRoute(
    routingKey: string,
  ): Promise<{
    tenantId: string;
    inboundAddress: string;
    connected: boolean;
    error: string | null;
  } | null> {
    if (this.emailIdentities) {
      const identity = await this.emailIdentities.findOne({
        where: { inboundAddress: routingKey },
      });
      if (identity) {
        return {
          tenantId: identity.tenantId,
          inboundAddress: identity.inboundAddress,
          connected: !['failed', 'blocked'].includes(identity.emailStatus),
          error: identity.lastError,
        };
      }
    }
    const direct = await this.credentialsRepo.findOne({
      where: { provider: 'sendgrid', routingKey },
      relations: ['tenant'],
    });
    if (direct) {
      const payload = decryptIntegrationPayload(direct.encryptedValue);
      return {
        tenantId: direct.tenant.id,
        inboundAddress: String(payload?.inboundAddress || ''),
        connected: Boolean(payload?.connected),
        error: payload?.error || null,
      };
    }
    const legacy = await this.credentialsRepo.find({
      where: { provider: 'sendgrid', routingKey: IsNull() },
      relations: ['tenant'],
    });
    const matches = legacy.filter((row) => {
      const payload = decryptIntegrationPayload(row.encryptedValue);
      return extractEmailAddress(payload?.inboundAddress) === routingKey;
    });
    if (matches.length !== 1) return null;
    matches[0].routingKey = routingKey;
    try {
      const saved = await this.credentialsRepo.save(matches[0]);
      const payload = decryptIntegrationPayload(saved.encryptedValue);
      return {
        tenantId: saved.tenant.id,
        inboundAddress: String(payload?.inboundAddress || ''),
        connected: Boolean(payload?.connected),
        error: payload?.error || null,
      };
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      const saved = await this.credentialsRepo.findOne({
        where: { provider: 'sendgrid', routingKey },
        relations: ['tenant'],
      });
      if (!saved) return null;
      const payload = decryptIntegrationPayload(saved.encryptedValue);
      return {
        tenantId: saved.tenant.id,
        inboundAddress: String(payload?.inboundAddress || ''),
        connected: Boolean(payload?.connected),
        error: payload?.error || null,
      };
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
      subject: string;
      text: string;
      providerMessageId: string;
      stopKeyword: boolean;
    },
  ): Promise<PersistedInbound> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      input.providerMessageId,
    ]);
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `lead-dedup:${input.tenantId}:email:${input.from}`,
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
      const tenant = await manager.getRepository(Tenant).findOne({
        where: { id: input.tenantId },
        lock: { mode: 'pessimistic_read' },
      });
      if (!tenant) throw new BadRequestException('Inbound tenant not found');
      assertLeadAcceptance(tenant, { source: 'sendgrid_inbound' });
      lead = await leadRepository.save(
        leadRepository.create({
          tenantId: input.tenantId,
          fullName: input.from,
          email: input.from,
          emailEligible: true,
          smsEligible: false,
          communicationStatus: 'active',
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
        subject: input.subject || null,
        providerMessageId: input.providerMessageId,
        status: 'received',
        providerStatus: 'received',
        sentAt: receivedAt,
        attemptCount: 0,
        communicationType: 'email',
        requiresBookingLink: false,
        jobPurpose: 'ordinary',
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

  private async recordReadinessEvidenceSafely(
    tenantId: string,
    evidence: {
      inboundSms?: boolean;
      inboundEmail?: boolean;
      stop?: boolean;
      providerRejection?: boolean;
      outboundDelivered?: boolean;
      testRunId?: string | null;
    },
  ) {
    if (!this.onboarding) return;
    try {
      await this.onboarding.recordAutomatedTestEvidence(tenantId, evidence);
    } catch (error: unknown) {
      this.logger.error(
        operationalEvent('readiness_evidence_record_failed', {
          tenantId,
          evidenceKeys: Object.entries(evidence)
            .filter(([, enabled]) => enabled)
            .map(([key]) => key),
          error: sanitizeOperationalText(
            error instanceof Error ? error.message : String(error),
          ),
        }),
      );
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

function sendGridMessageState(
  eventType: string,
): { status: Message['status']; rank: number } | null {
  if (eventType === 'processed') return { status: 'provider_accepted', rank: 2 };
  if (eventType === 'delivered') return { status: 'delivered', rank: 5 };
  if (['bounce', 'dropped', 'blocked'].includes(eventType)) {
    return { status: 'failed', rank: 4 };
  }
  return null;
}

export type SendGridDisposition =
  | 'consent_opt_out'
  | 'permanent_suppression'
  | 'transient_failure'
  | 'none';

export function classifySendGridDisposition(
  eventType: string,
  event: Record<string, unknown>,
): SendGridDisposition {
  if (['spamreport', 'unsubscribe', 'group_unsubscribe'].includes(eventType)) {
    return 'consent_opt_out';
  }
  if (['blocked', 'deferred'].includes(eventType)) return 'transient_failure';
  if (eventType === 'bounce') {
    const status = String(event.status || event.response || '').trim();
    const bounceType = String(event.type || '').trim().toLowerCase();
    if (status.startsWith('4') || bounceType === 'blocked') {
      return 'transient_failure';
    }
    return 'permanent_suppression';
  }
  if (eventType === 'dropped') {
    const detail = String(event.reason || event.response || '').toLowerCase();
    return /invalid|no such user|unknown user|hard bounce|suppression|unsubscrib|spam report|does not exist/.test(
      detail,
    )
      ? 'permanent_suppression'
      : 'transient_failure';
  }
  return 'none';
}

function isSendGridDeliveryEvent(eventType: string) {
  return [
    'processed',
    'deferred',
    'delivered',
    'bounce',
    'dropped',
    'blocked',
  ].includes(eventType);
}

function validUuid(value: unknown) {
  const candidate = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    candidate,
  )
    ? candidate
    : null;
}

function safeProviderEventValue(value: unknown) {
  if (value === undefined || value === null) return null;
  return sanitizeOperationalText(value).slice(0, 200);
}

function deterministicUuid(value: string) {
  const hex = crypto.createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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
