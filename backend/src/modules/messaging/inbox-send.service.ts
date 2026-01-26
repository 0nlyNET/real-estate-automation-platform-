import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as crypto from 'crypto';

import { Lead } from '../leads/lead.entity';
import { Message } from './message.entity';
import { Credential } from '../settings/credential.entity';

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
  return s.replace(/[()\-\s\.]/g, '');
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
  ) {}

  private requireTenant(tenantId?: string | null) {
    if (!tenantId) throw new ForbiddenException('Missing tenant');
    return tenantId;
  }

  async sendSmsToLead(tenantIdRaw: string, leadId: string, body: string) {
    const tenantId = this.requireTenant(tenantIdRaw);

    const text = (body || '').toString().trim();
    if (!text) throw new ForbiddenException('Message body is required');

    const lead = await this.leadsRepo.findOne({ where: { id: leadId, tenantId } as any });
    if (!lead) throw new ForbiddenException('Lead not found');

    const to = normalizeE164(lead.phone);
    if (!to) throw new ForbiddenException('Lead phone is missing');

    // IMPORTANT: do not assume Credential has tenantId mapped correctly.
    // We match by relation tenant.id to avoid DB casing mismatches.
    const creds = await this.credentialsRepo.find({
      where: { provider: 'twilio' as any } as any,
      relations: ['tenant'],
    });

    const match = creds.find((c: any) => c?.tenant?.id === tenantId) as any;

    const payload = decryptToJson(match?.encryptedValue);
    const connected = Boolean(payload?.connected);

    const accountSid = payload?.accountSid ? String(payload.accountSid) : null;
    const authToken = payload?.authToken ? String(payload.authToken) : null;
    const fromNumber = normalizeE164(payload?.fromNumber);

    if (!match || !connected || !accountSid || !authToken || !fromNumber) {
      throw new ForbiddenException('Twilio is not connected for this tenant');
    }

    // Create pending message row first (so UI can show failures too)
    const msg = new Message() as any;
    msg.leadId = lead.id;
    msg.channel = 'sms';
    msg.direction = 'outbound';
    msg.body = text;
    msg.status = 'pending';
    msg.attemptCount = 0;
    msg.sentAt = null;

    const saved = await this.messagesRepo.save(msg as any);

    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;

      const params = new URLSearchParams();
      params.set('To', to);
      params.set('From', fromNumber);
      params.set('Body', text);

      const resp = await axios.post(url, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: { username: accountSid, password: authToken },
        timeout: 20_000,
      });

      const sid = resp?.data?.sid ? String(resp.data.sid) : undefined;

      (saved as any).providerMessageId = sid;
      (saved as any).status = 'sent';
      (saved as any).attemptCount = ((saved as any).attemptCount || 0) + 1;
      (saved as any).sentAt = new Date();
      await this.messagesRepo.save(saved as any);

      (lead as any).lastActivityAt = new Date();
      (lead as any).lastContactedAt = new Date();
      await this.leadsRepo.save(lead as any);

      this.logger.log(`Outbound SMS sent. tenant=${tenantId} lead=${lead.id} to=${to} sid=${sid || 'n/a'}`);

      return {
        status: 'sent',
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
      const errMsg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.response?.data?.details ||
        e?.message ||
        'Twilio send failed';

      (saved as any).status = 'failed';
      (saved as any).attemptCount = ((saved as any).attemptCount || 0) + 1;
      (saved as any).lastError = String(errMsg);
      await this.messagesRepo.save(saved as any);

      this.logger.warn(`Outbound SMS failed. tenant=${tenantId} lead=${lead.id} to=${to} err=${String(errMsg)}`);

      return {
        status: 'failed',
        error: String(errMsg),
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
    }
  }
}
