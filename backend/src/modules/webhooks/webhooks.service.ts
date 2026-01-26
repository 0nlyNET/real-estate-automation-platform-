import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';

import { Credential } from '../settings/credential.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';

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
  return s.replace(/[()\-\s\.]/g, '');
}

function now() {
  return new Date();
}

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
  ) {}

  async handleTwilioInbound(body: TwilioInboundBody, _headers: Record<string, string | undefined>) {
    const from = normalizePhone(body.From);
    const to = normalizePhone(body.To);
    const text = (body.Body || '').toString();
    const providerMessageId = (body.MessageSid || body.SmsSid || '').toString() || undefined;

    if (!from || !to || !text) {
      this.logger.warn(`Twilio inbound ignored. From=${from} To=${to} Len=${text.length}`);
      return;
    }

    // Find tenant by matching To against saved twilio.fromNumber
    const creds = await this.credentialsRepo.find({
      where: { provider: 'twilio' as any },
      relations: ['tenant'],
    });

    let tenantId: string | null = null;

    for (const c of creds) {
      const payload = decryptToJson(c.encryptedValue);
      const connected = Boolean(payload?.connected);
      const fromNumber = normalizePhone(payload?.fromNumber);

      if (connected && fromNumber && fromNumber === to) {
        tenantId = c.tenant?.id || null;
        break;
      }
    }

    if (!tenantId) {
      this.logger.warn(`Twilio inbound: no tenant match for To=${to}`);
      return;
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

    // Update lead activity timestamps (if fields exist on entity)
    (lead as any).lastActivityAt = now();
    (lead as any).lastContactedAt = now();
    await this.leadsRepo.save(lead as any);

    this.logger.log(`Twilio inbound saved. tenant=${tenantId} lead=${(lead as any).id} from=${from} to=${to}`);
  }
}
