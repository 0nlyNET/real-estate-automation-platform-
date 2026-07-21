import { BadGatewayException, ConflictException, Injectable, ForbiddenException, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as crypto from 'crypto';

import { Lead } from '../leads/lead.entity';
import { Message } from './message.entity';
import { Credential } from '../settings/credential.entity';
import { sendTwilioSms } from '../../common/providers';
import { ComplianceService } from '../compliance/compliance.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { OperationsService } from '../operations/operations.service';
import {
  operationalEvent,
  sanitizeOperationalText,
} from '../../common/operational-log';
import { NotificationsService } from '../notifications/notifications.service';

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
  private readonly logger = new Logger(InboxSendService.name);

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
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  private requireTenant(tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('Missing tenant');
    return tenantId;
  }

  async sendSmsToLead(tenantIdRaw: string, leadId: string, body: string) {
    const tenantId = this.requireTenant(tenantIdRaw);

    const text = (body || '').toString().trim();
    if (!text) throw new ForbiddenException('Message body is required');

    const lead = await this.leadsRepo.findOne({
      where: { id: leadId, tenantId } as any,
      relations: ['tenant'],
    });
    if (!lead) throw new ForbiddenException('Lead not found');

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

    const match = await this.credentialsRepo.findOne({
      where: {
        provider: 'twilio' as any,
        tenant: { id: tenantId } as any,
      },
      relations: ['tenant'],
    });

    const payload = decryptToJson(match?.encryptedValue);
    const connected = Boolean(payload?.connected);

    const accountSid = payload?.accountSid ? String(payload.accountSid) : null;
    const authToken = payload?.authToken ? String(payload.authToken) : null;
    const fromNumber = normalizeE164(payload?.fromNumber);

    if (!match || !connected || !accountSid || !authToken || !fromNumber) {
      throw new ForbiddenException('Twilio is not connected for this tenant');
    }
    const statusCallback = String(process.env.TWILIO_STATUS_CALLBACK_URL || '').trim();
    if (!statusCallback) {
      throw new ForbiddenException('Twilio delivery status callback is not configured');
    }

    // Create pending message row first (so UI can show failures too)
    const priorContact = await this.messagesRepo.count({
      where: {
        leadId: lead.id,
        channel: 'sms',
        direction: 'outbound',
        status: In(['provider_accepted', 'sent', 'delivered']),
      } as any,
    });
    const identity = String(lead.tenant?.name || 'RealtyTechAI').trim();
    const compliantText = priorContact === 0
      ? `${identity}: ${text}${/\bstop\b/i.test(text) ? '' : ' Reply STOP to opt out.'}`
      : text;

    const msg = new Message() as any;
    msg.leadId = lead.id;
    msg.channel = 'sms';
    msg.direction = 'outbound';
    msg.body = compliantText;
    msg.status = 'sending';
    msg.attemptCount = 0;
    msg.sentAt = null;
    msg.idempotencyKey = `manual:${tenantId}:${lead.id}:${crypto.randomUUID()}`;

    const saved = await this.messagesRepo.save(msg as any);

    try {
      const resp = await sendTwilioSms({
        accountSid,
        authToken,
        to,
        from: fromNumber,
        body: compliantText,
        statusCallback,
      });

      const sid = resp.sid ? String(resp.sid) : undefined;

      (saved as any).providerMessageId = sid;
      (saved as any).status = 'provider_accepted';
      (saved as any).providerStatus = resp.status || 'accepted';
      (saved as any).attemptCount = ((saved as any).attemptCount || 0) + 1;
      (saved as any).providerAcceptedAt = new Date();
      await this.messagesRepo.save(saved as any);

      (lead as any).lastActivityAt = new Date();
      (lead as any).lastContactedAt = new Date();
      await this.leadsRepo.save(lead as any);

      this.logger.log(
        operationalEvent('manual_sms_provider_accepted', {
          tenantId,
          leadId: lead.id,
          providerMessageId: sid || null,
        }),
      );

      return {
        status: 'provider_accepted',
        message: {
          id: (saved as any).id,
          leadId: (saved as any).leadId,
          channel: (saved as any).channel,
          direction: (saved as any).direction,
          body: (saved as any).body,
          status: (saved as any).status,
          providerMessageId: (saved as any).providerMessageId || null,
          createdAt: (saved as any).createdAt,
        },
      };
    } catch (e: any) {
      const errMsg = sanitizeOperationalText(
        e?.message || 'Twilio send failed',
      );

      (saved as any).status = 'failed';
      (saved as any).failedAt = new Date();
      (saved as any).errorCode = 'PROVIDER_SEND_FAILED';
      (saved as any).sanitizedErrorMessage = String(errMsg).slice(0, 1000);
      (saved as any).attemptCount = ((saved as any).attemptCount || 0) + 1;
      (saved as any).lastError = String(errMsg);
      await this.messagesRepo.save(saved as any);

      this.logger.warn(
        operationalEvent('provider_send_failed', {
          provider: 'twilio',
          tenantId,
          leadId: lead.id,
          messageId: saved.id,
          error: errMsg,
        }),
      );

      await this.operations.createTask({
        tenantId,
        category: 'messaging_failure',
        title: 'Manual SMS failed',
        description: String(errMsg).slice(0, 1000),
        priority: 'high',
        relatedEntityType: 'message',
        relatedEntityId: saved.id,
        dedupeOpen: true,
      });
      await this.notifications?.createForTenant({
        tenantId,
        assignedUserId: lead.assignedToUserId,
        eventType: 'message.failed',
        category: 'leads',
        severity: 'warning',
        title: `A message to ${lead.fullName} did not send`,
        message: 'Open the conversation and try again or contact the lead another way.',
        deduplicationKey: `message-failed:${saved.id}`,
        actionUrl: `/app/inbox?leadId=${lead.id}`,
        entityType: 'message',
        entityId: saved.id,
      });
      throw new BadGatewayException({
        code: 'PROVIDER_SEND_FAILED',
        message: 'Twilio did not accept the message',
        messageId: saved.id,
      });
    }
  }
}
