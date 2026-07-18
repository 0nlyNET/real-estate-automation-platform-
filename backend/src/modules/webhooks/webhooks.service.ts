import {
  BadRequestException,
  Injectable,
  Logger,
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

export type TwilioInboundBody = Record<string, unknown> & {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
  SmsSid?: string;
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
  ) {}

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
      throw new UnauthorizedException('Invalid Facebook webhook signature');
    }
    const expected = `sha256=${crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex')}`;
    if (!safeEqual(expected, supplied)) {
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
      `Facebook lead ${leadgenId} saved for tenant=${credential.tenant.id}`,
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
        'Twilio inbound did not match a connected tenant number',
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

    this.logger.log(
      `Twilio inbound saved for tenant=${tenantId} lead=${persisted.leadId}`,
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
      stopKeyword: input.stopKeyword,
    };
  }
}

function safeEqual(expected: string, supplied: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
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
