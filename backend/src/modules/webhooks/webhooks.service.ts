import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';

import { Credential } from '../settings/credential.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { decryptIntegrationPayload } from '../integrations/integrations.service';
import { ComplianceService } from '../compliance/compliance.service';
import { SequencesService } from '../sequences/sequences.service';

type TwilioInboundBody = {
  From?: string;
  To?: string;
  Body?: string;
  MessageSid?: string;
  SmsSid?: string;
};

function normalizePhone(v?: string | null) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  let digits = s.replace(/\D/g, '');
  if (digits.length === 10) digits = `1${digits}`;
  return digits;
}

function now() {
  return new Date();
}

function validTwilioSignature(
  url: string,
  params: Record<string, unknown>,
  authToken: string,
  supplied: string,
) {
  const payload = url + Object.keys(params).sort().map((key) => `${key}${String(params[key] ?? '')}`).join('');
  const expected = crypto.createHmac('sha1', authToken).update(payload).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(Credential)
    private readonly credentialsRepo: Repository<Credential>,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(Message)
    private readonly messagesRepo: Repository<Message>,
    private readonly compliance: ComplianceService,
    private readonly sequences: SequencesService,
  ) {}

  async handleTwilioInbound(body: TwilioInboundBody, headers: Record<string, string | undefined>) {
    const from = normalizePhone(body.From);
    const to = normalizePhone(body.To);
    const text = (body.Body || '').toString();
    const providerMessageId = (body.MessageSid || body.SmsSid || '').toString() || undefined;

    if (!from || !to || !text) {
      this.logger.warn('Twilio inbound ignored because required fields were missing');
      return;
    }

    // Find tenant by matching To against saved twilio.fromNumber
    const creds = await this.credentialsRepo.find({
      where: { provider: 'twilio' as any },
      relations: ['tenant'],
    });

    let tenantId: string | null = null;
    let authToken: string | null = null;

    for (const c of creds) {
      const payload = decryptIntegrationPayload(c.encryptedValue);
      const connected = Boolean(payload?.connected);
      const fromNumber = normalizePhone(payload?.fromNumber);

      if (connected && fromNumber && fromNumber === to) {
        tenantId = c.tenant?.id || null;
        authToken = payload?.authToken ? String(payload.authToken) : null;
        break;
      }
    }

    if (!tenantId) {
      this.logger.warn('Twilio inbound did not match a connected tenant number');
      return;
    }

    const signature = String(headers['x-twilio-signature'] || '');
    const webhookUrl = String(process.env.TWILIO_WEBHOOK_URL || '').trim();
    if (!authToken || !webhookUrl || !validTwilioSignature(webhookUrl, body as any, authToken, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (providerMessageId) {
      const duplicate = await this.messagesRepo.findOne({ where: { providerMessageId } as any });
      if (duplicate) return;
    }

    // Find lead by tenantId + phone
    let lead: Lead | null = await this.leadsRepo.findOne({
      where: { tenantId: tenantId as any, phone: from as any } as any,
    });

    if (!lead) {
      const l = new Lead() as any;
      l.tenantId = tenantId;
      l.fullName = from;
      l.phone = from;
      l.source = 'twilio';
      l.stage = 'new';
      l.score = 50;

      lead = await this.leadsRepo.save(l);
    }

    // Save inbound message
    const msg = new Message() as any;
    msg.lead = lead as any;
    msg.channel = 'sms';
    msg.direction = 'inbound';
    msg.body = text;
    msg.providerMessageId = providerMessageId;
    msg.status = 'received';
    msg.sentAt = now();
    msg.attemptCount = 0;

    await this.messagesRepo.save(msg);

    if (this.compliance.isStopKeyword(text)) {
      await this.compliance.addOptOut(tenantId, 'sms', from, 'stop_keyword', 'twilio_webhook');
      await this.sequences.stopForLead((lead as Lead).id, 'opt_out');
      (lead as any).sequenceStatus = 'stopped';
    }

    // Update lead activity timestamps (if fields exist on entity)
    (lead as any).lastActivityAt = now();
    (lead as any).lastContactedAt = now();
    await this.leadsRepo.save(lead as any);

    this.logger.log(`Twilio inbound saved for tenant=${tenantId} lead=${(lead as any).id}`);
  }
}
