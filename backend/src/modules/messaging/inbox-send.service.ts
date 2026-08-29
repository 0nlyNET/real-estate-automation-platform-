import {
  ConflictException,
  Injectable,
  ForbiddenException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';

import { Lead } from '../leads/lead.entity';
import { Message } from './message.entity';
import { Credential } from '../settings/credential.entity';
import { ComplianceService } from '../compliance/compliance.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { OperationsService } from '../operations/operations.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AiConversationControlService,
  ConversationActor,
} from '../ai/ai-conversation-control.service';
import { ProviderConfigService } from '../integrations/provider-config.service';

function isV1Encrypted(v: string) {
  return typeof v === 'string' && v.startsWith('v1:');
}

function getEncKey(): Buffer {
  const b64 = process.env.INTEGRATIONS_ENCRYPTION_KEY || '';
  if (!b64.trim()) throw new Error('INTEGRATIONS_ENCRYPTION_KEY is missing in backend/.env');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('INTEGRATIONS_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

function decryptToJson(value: string | null | undefined): any {
  if (!value) return null;

  // legacy plaintext rows
  if (!isV1Encrypted(value)) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  try {
    const parts = value.split(':');
    if (parts.length !== 4) return null;

    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');

    const key = getEncKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(plaintext);
  } catch {
    return null;
  }
}

function normalizeE164(v?: string | null) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.replace(/[().\s-]/g, '');
}

@Injectable()
export class InboxSendService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(Message)
    private readonly messagesRepo: Repository<Message>,
    @InjectRepository(Credential)
    private readonly credentialsRepo: Repository<Credential>,
    private readonly compliance: ComplianceService,
    private readonly entitlements: EntitlementService,
    private readonly operations: OperationsService,
    private readonly aiControl: AiConversationControlService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly providerConfig?: ProviderConfigService,
  ) {}

  private requireTenant(tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('Missing tenant');
    return tenantId;
  }

  async sendSmsToLead(
    tenantIdRaw: string,
    leadId: string,
    body: string,
    actor?: ConversationActor,
    requestId?: string,
  ) {
    const tenantId = this.requireTenant(tenantIdRaw);

    const text = (body || '').toString().trim();
    if (!text) throw new ForbiddenException('Message body is required');

    const lead = await this.leadsRepo.findOne({
      where: { id: leadId, tenantId } as any,
      relations: ['tenant'],
    });
    if (!lead) throw new ForbiddenException('Lead not found');

    const idempotencyKey = manualRequestKey(
      'sms',
      tenantId,
      lead.id,
      actor?.userId,
      requestId,
    );
    const existing = await this.messagesRepo.findOne({
      where: { idempotencyKey, leadId: lead.id },
    });
    if (existing) return existingManualResponse(existing, text);

    const to = normalizeE164(lead.phone);
    if (!to) throw new ForbiddenException('Lead phone is missing');
    await this.entitlements.assertAllowed(tenantId, 'send_manual_sms');
    const consent = await this.compliance.communicationEligibility(tenantId, lead, 'sms');
    if (!consent.allowed) {
      throw new ConflictException({
        code: consent.code,
        message: consent.reason,
      });
    }

    const managedTwilio = await this.providerConfig?.resolveTwilio(tenantId);
    const match = managedTwilio ? null : await this.credentialsRepo.findOne({
      where: {
        provider: 'twilio' as any,
        tenant: { id: tenantId } as any,
      },
      relations: ['tenant'],
    });

    const payload = managedTwilio || decryptToJson(match?.encryptedValue);
    const connected = managedTwilio ? true : Boolean(payload?.connected);

    const accountSid = payload?.accountSid ? String(payload.accountSid) : null;
    const authToken = payload?.authToken ? String(payload.authToken) : null;
    const fromNumber = normalizeE164(payload?.fromNumber);
    const messagingServiceSid = String(payload?.messagingServiceSid || '').trim();

    if (
      (!match && !managedTwilio) ||
      !connected ||
      !accountSid ||
      !authToken ||
      (!fromNumber && !messagingServiceSid)
    ) {
      throw new ConflictException({
        code: 'SMS_INTEGRATION_DISCONNECTED',
        message:
          'SMS is not connected for this workspace. Connect Twilio in Integrations before replying.',
      });
    }
    const statusCallback = String(process.env.TWILIO_STATUS_CALLBACK_URL || '').trim();
    if (!statusCallback) {
      throw new ServiceUnavailableException({
        code: 'SMS_DELIVERY_CALLBACK_NOT_CONFIGURED',
        message:
          'SMS delivery tracking is not configured yet. A platform administrator must finish the Twilio callback setup.',
      });
    }

    return this.aiControl.runHumanSendExclusive(
      tenantId,
      lead.id,
      actor,
      async () => {
        const duplicate = await this.messagesRepo.findOne({
          where: { idempotencyKey, leadId: lead.id },
        });
        if (duplicate) return existingManualResponse(duplicate, text);
        // Create the row while holding the conversation lock so no AI message
        // can pass its final send check concurrently.
        const priorContact = await this.messagesRepo.count({
          where: {
            leadId: lead.id,
            channel: 'sms',
            direction: 'outbound',
            status: In(['provider_accepted', 'sent', 'delivered']),
          } as any,
        });
        const identity = String(lead.tenant?.name || 'RealtyTechAI').trim();
        const alreadyIdentified = text
          .toLowerCase()
          .startsWith(`${identity.toLowerCase()}:`);
        const compliantText = priorContact === 0
          ? `${alreadyIdentified ? '' : `${identity}: `}${text}${/\bstop\b/i.test(text) ? '' : ' Reply STOP to opt out.'}`
          : text;

        const msg = new Message() as any;
        msg.leadId = lead.id;
        msg.channel = 'sms';
        msg.direction = 'outbound';
        msg.body = compliantText;
        msg.status = 'queued';
        msg.attemptCount = 0;
        msg.sentAt = null;
        msg.authorship = 'human';
        msg.communicationType = 'sms';
        msg.requiresBookingLink = false;
        msg.idempotencyKey = idempotencyKey;

        const saved = await this.messagesRepo.save(msg as any);
        return {
          status: 'queued',
          message: {
            id: (saved as any).id,
            leadId: (saved as any).leadId,
            channel: (saved as any).channel,
            direction: (saved as any).direction,
            body: (saved as any).body,
            status: (saved as any).status,
            authorship: 'human',
            providerMessageId: null,
            createdAt: (saved as any).createdAt,
          },
        };
      },
    );
  }

  async queueEmailToLead(
    tenantIdRaw: string,
    leadId: string,
    body: string,
    actor?: ConversationActor,
    requestId?: string,
  ) {
    const tenantId = this.requireTenant(tenantIdRaw);
    const text = String(body || '').trim();
    if (!text) throw new ForbiddenException('Message body is required');
    if (text.length > 1_600) {
      throw new ForbiddenException('Message body exceeds 1,600 characters');
    }
    const lead = await this.leadsRepo.findOne({
      where: { id: leadId, tenantId } as any,
      relations: ['tenant'],
    });
    if (!lead) throw new ForbiddenException('Lead not found');
    const idempotencyKey = manualRequestKey(
      'email',
      tenantId,
      lead.id,
      actor?.userId,
      requestId,
    );
    const existing = await this.messagesRepo.findOne({
      where: { idempotencyKey, leadId: lead.id },
    });
    if (existing) return existingManualResponse(existing, text);
    if (!lead.email) throw new ForbiddenException('Lead email is missing');
    await this.entitlements.assertAllowed(tenantId, 'send_manual_email');
    const consent = await this.compliance.communicationEligibility(
      tenantId,
      lead,
      'email',
    );
    if (!consent.allowed) {
      throw new ConflictException({
        code: consent.code,
        message: consent.reason,
      });
    }
    const managedSendGrid = await this.providerConfig?.resolveSendGrid(tenantId);
    const credential = managedSendGrid ? null : await this.credentialsRepo.findOne({
      where: {
        provider: 'sendgrid' as any,
        tenant: { id: tenantId } as any,
      },
      relations: ['tenant'],
    });
    const payload = managedSendGrid || decryptToJson(credential?.encryptedValue);
    if (
      (!credential && !managedSendGrid) ||
      !payload?.connected ||
      payload?.error ||
      !String(payload?.apiKey || '').trim() ||
      !String(payload?.fromEmail || '').trim()
    ) {
      throw new ConflictException({
        code: 'EMAIL_INTEGRATION_DISCONNECTED',
        message:
          'Email is not connected for this workspace. Connect SendGrid in Integrations before replying.',
      });
    }
    return this.aiControl.runHumanSendExclusive(
      tenantId,
      lead.id,
      actor,
      async () => {
        const duplicate = await this.messagesRepo.findOne({
          where: { idempotencyKey, leadId: lead.id },
        });
        if (duplicate) return existingManualResponse(duplicate, text);
        const latestInbound = await this.messagesRepo.findOne({
          where: {
            leadId: lead.id,
            channel: 'email',
            direction: 'inbound',
          },
          order: { createdAt: 'DESC' },
        });
        const message = await this.messagesRepo.save(
          this.messagesRepo.create({
            leadId: lead.id,
            channel: 'email',
            direction: 'outbound',
            body: `${text}\n\nUnsubscribe: {{unsubscribeUrl}}`,
            subject: replySubject(latestInbound?.subject),
            inReplyToProviderMessageId:
              latestInbound?.providerMessageId || null,
            status: 'queued',
            attemptCount: 0,
            idempotencyKey,
            authorship: 'human',
          }),
        );
        return {
          status: 'queued',
          message: {
            id: message.id,
            leadId: message.leadId,
            channel: message.channel,
            direction: message.direction,
            body: text,
            status: message.status,
            authorship: message.authorship,
            createdAt: message.createdAt,
          },
        };
      },
    );
  }
}

function manualRequestKey(
  channel: 'sms' | 'email',
  tenantId: string,
  leadId: string,
  userId?: string,
  requestId?: string,
) {
  return [
    'manual',
    channel,
    tenantId,
    leadId,
    userId || 'system',
    requestId || crypto.randomUUID(),
  ].join(':');
}

function existingManualResponse(message: Message, requestedBody: string) {
  const emailBody = `${requestedBody}\n\nUnsubscribe: {{unsubscribeUrl}}`;
  const smsSuffix = `${requestedBody}${
    /\bstop\b/i.test(requestedBody) ? '' : ' Reply STOP to opt out.'
  }`;
  const sameBody =
    message.channel === 'email'
      ? message.body === emailBody
      : message.body === requestedBody ||
        message.body === smsSuffix ||
        message.body.endsWith(`: ${smsSuffix}`);
  if (message.authorship !== 'human' || !sameBody) {
    throw new ConflictException({
      code: 'MESSAGE_REQUEST_ID_REUSED',
      message: 'This message request ID was already used for different text.',
    });
  }
  return {
    status: message.status,
    duplicate: true,
    message: {
      id: message.id,
      leadId: message.leadId,
      channel: message.channel,
      direction: message.direction,
      body:
        message.channel === 'email'
          ? message.body.replace(
              /\n\nUnsubscribe:\s*\{\{unsubscribeUrl\}\}\s*$/i,
              '',
            )
          : message.body,
      status: message.status,
      authorship: message.authorship,
      providerMessageId: message.providerMessageId || null,
      createdAt: message.createdAt,
    },
  };
}

function replySubject(subject?: string | null) {
  const value = String(subject || '').trim().slice(0, 490);
  if (!value) return 'Follow-up';
  return /^re:/i.test(value) ? value : `Re: ${value}`;
}
