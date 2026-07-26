import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { normalizePhoneE164 } from '../../common/phone';
import { Credential } from '../settings/credential.entity';
import { decryptIntegrationPayload } from './integrations.service';
import { PlatformCredential } from './platform-credential.entity';

export type ManagedMessagingProvider = 'twilio' | 'sendgrid';

type TwilioPlatformPayload = {
  configured: boolean;
  connected: boolean;
  accountSid: string;
  authToken: string;
  lastSync: string;
  error: string | null;
};

type SendGridPlatformPayload = {
  configured: boolean;
  connected: boolean;
  apiKey: string;
  lastSync: string;
  error: string | null;
};

function encryptionKey(): Buffer {
  const raw = String(process.env.INTEGRATIONS_ENCRYPTION_KEY || '').trim();
  if (!raw) throw new Error('INTEGRATIONS_ENCRYPTION_KEY is missing');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('INTEGRATIONS_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return key;
}

function encryptPayload(payload: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function mask(value: string | null | undefined, keep = 4) {
  const text = String(value || '');
  if (!text) return null;
  if (text.length <= keep) return text;
  return `${'*'.repeat(Math.max(4, text.length - keep))}${text.slice(-keep)}`;
}

function email(value: string | null | undefined, label: string) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new BadRequestException(`${label} is invalid`);
  }
  return normalized;
}

function uniqueViolation(error: unknown) {
  return String((error as { code?: string })?.code || '') === '23505';
}

@Injectable()
export class PlatformIntegrationsService {
  constructor(
    @InjectRepository(PlatformCredential)
    private readonly platformCredentials: Repository<PlatformCredential>,
    @InjectRepository(Credential)
    private readonly tenantCredentials: Repository<Credential>,
  ) {}

  private async platformRow(provider: ManagedMessagingProvider) {
    return this.platformCredentials.findOne({ where: { provider } });
  }

  private async platformPayload(provider: ManagedMessagingProvider) {
    const row = await this.platformRow(provider);
    return row ? decryptIntegrationPayload(row.encryptedValue) : null;
  }

  private async savePlatformPayload(
    provider: ManagedMessagingProvider,
    payload: TwilioPlatformPayload | SendGridPlatformPayload,
  ) {
    let row = await this.platformRow(provider);
    if (!row) {
      row = this.platformCredentials.create({ provider, encryptedValue: encryptPayload(payload) });
    } else {
      row.encryptedValue = encryptPayload(payload);
    }
    await this.platformCredentials.save(row);
    return row;
  }

  private async tenantRow(tenantId: string, provider: ManagedMessagingProvider) {
    return this.tenantCredentials.findOne({
      where: { tenant: { id: tenantId } as any, provider },
      relations: ['tenant'],
    });
  }

  private async saveTenantPayload(
    tenantId: string,
    provider: ManagedMessagingProvider,
    payload: Record<string, unknown>,
    routingKey: string | null,
  ) {
    let row = await this.tenantRow(tenantId, provider);
    if (!row) {
      row = this.tenantCredentials.create({
        tenant: { id: tenantId } as any,
        provider,
        encryptedValue: encryptPayload(payload),
        routingKey,
      });
    } else {
      row.encryptedValue = encryptPayload(payload);
      row.routingKey = routingKey;
    }
    try {
      await this.tenantCredentials.save(row);
    } catch (error) {
      if (uniqueViolation(error)) {
        throw new BadRequestException(
          provider === 'twilio'
            ? 'That Twilio number is already assigned to another client.'
            : 'That inbound email address is already assigned to another client.',
        );
      }
      throw error;
    }
    return row;
  }

  async platformSummary() {
    const [twilioRow, sendgridRow] = await Promise.all([
      this.platformRow('twilio'),
      this.platformRow('sendgrid'),
    ]);
    const twilio = twilioRow
      ? (decryptIntegrationPayload(twilioRow.encryptedValue) as TwilioPlatformPayload)
      : null;
    const sendgrid = sendgridRow
      ? (decryptIntegrationPayload(sendgridRow.encryptedValue) as SendGridPlatformPayload)
      : null;
    return {
      twilio: {
        configured: Boolean(twilio?.configured),
        connected: Boolean(twilio?.connected),
        status: twilio?.error
          ? 'error'
          : twilio?.connected
            ? 'connected'
            : twilio?.configured
              ? 'configured'
              : 'disconnected',
        error: twilio?.error || null,
        lastSync: twilio?.lastSync || null,
        accountSid: twilio?.accountSid ? mask(twilio.accountSid, 6) : null,
      },
      sendgrid: {
        configured: Boolean(sendgrid?.configured),
        connected: Boolean(sendgrid?.connected),
        status: sendgrid?.error
          ? 'error'
          : sendgrid?.connected
            ? 'connected'
            : sendgrid?.configured
              ? 'configured'
              : 'disconnected',
        error: sendgrid?.error || null,
        lastSync: sendgrid?.lastSync || null,
        apiKey: sendgrid?.apiKey ? `${sendgrid.apiKey.slice(0, 6)}...` : null,
      },
    };
  }

  async savePlatformTwilio(dto: { accountSid: string; authToken: string }) {
    const accountSid = String(dto.accountSid || '').trim();
    const authToken = String(dto.authToken || '').trim();
    if (!accountSid.startsWith('AC') || !authToken) {
      throw new BadRequestException('Valid Twilio Account SID and Auth Token are required');
    }
    const payload: TwilioPlatformPayload = {
      configured: true,
      connected: false,
      accountSid,
      authToken,
      lastSync: nowIso(),
      error: null,
    };
    await this.savePlatformPayload('twilio', payload);
    await this.propagateTwilio(payload);
    return this.platformSummary();
  }

  async savePlatformSendGrid(dto: { apiKey: string }) {
    const apiKey = String(dto.apiKey || '').trim();
    if (!apiKey.startsWith('SG.')) {
      throw new BadRequestException('A valid SendGrid API key is required');
    }
    const payload: SendGridPlatformPayload = {
      configured: true,
      connected: false,
      apiKey,
      lastSync: nowIso(),
      error: null,
    };
    await this.savePlatformPayload('sendgrid', payload);
    await this.propagateSendGrid(payload);
    return this.platformSummary();
  }

  private async propagateTwilio(platform: TwilioPlatformPayload) {
    const rows = await this.tenantCredentials.find({ where: { provider: 'twilio' } });
    for (const row of rows) {
      const current = decryptIntegrationPayload(row.encryptedValue) || {};
      row.encryptedValue = encryptPayload({
        ...current,
        accountSid: platform.accountSid,
        authToken: platform.authToken,
        configured: Boolean(current.fromNumber),
        connected: false,
        managedByPlatform: true,
        error: null,
        lastSync: nowIso(),
      });
      await this.tenantCredentials.save(row);
    }
  }

  private async propagateSendGrid(platform: SendGridPlatformPayload) {
    const rows = await this.tenantCredentials.find({ where: { provider: 'sendgrid' } });
    for (const row of rows) {
      const current = decryptIntegrationPayload(row.encryptedValue) || {};
      row.encryptedValue = encryptPayload({
        ...current,
        apiKey: platform.apiKey,
        configured: Boolean(current.fromEmail),
        connected: false,
        managedByPlatform: true,
        error: null,
        lastSync: nowIso(),
      });
      await this.tenantCredentials.save(row);
    }
  }

  async testPlatformTwilio(dto: { fromNumber?: string; toNumber?: string; message?: string }) {
    const payload = (await this.platformPayload('twilio')) as TwilioPlatformPayload | null;
    if (!payload?.accountSid || !payload?.authToken) {
      throw new BadRequestException('Twilio platform credentials are not configured');
    }
    try {
      const auth = Buffer.from(`${payload.accountSid}:${payload.authToken}`).toString('base64');
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(payload.accountSid)}.json`,
        { headers: { Authorization: `Basic ${auth}` } },
      );
      if (!response.ok) {
        throw new Error(`Twilio credential test failed (${response.status})`);
      }
      const toNumber = dto.toNumber ? normalizePhoneE164(dto.toNumber) : null;
      const fromNumber = dto.fromNumber ? normalizePhoneE164(dto.fromNumber) : null;
      if (dto.toNumber && !toNumber) throw new BadRequestException('Test recipient is invalid');
      if (toNumber && !fromNumber) {
        throw new BadRequestException('A Twilio sending number is required to send a test SMS');
      }
      if (toNumber && fromNumber) {
        const form = new URLSearchParams();
        form.set('From', fromNumber);
        form.set('To', toNumber);
        form.set('Body', String(dto.message || 'RealtyTechAI platform test').trim());
        const send = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(payload.accountSid)}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${auth}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form.toString(),
          },
        );
        if (!send.ok) {
          const detail = await send.text().catch(() => '');
          throw new Error(`Twilio test SMS failed (${send.status}): ${detail}`);
        }
      }
      await this.savePlatformPayload('twilio', {
        ...payload,
        configured: true,
        connected: true,
        error: null,
        lastSync: nowIso(),
      });
      return { ok: true };
    } catch (error: any) {
      const message = String(error?.message || 'Twilio test failed').slice(0, 1000);
      await this.savePlatformPayload('twilio', {
        ...payload,
        configured: true,
        connected: false,
        error: message,
        lastSync: nowIso(),
      });
      return { ok: false, error: message };
    }
  }

  async testPlatformSendGrid(dto: { fromEmail?: string; toEmail?: string }) {
    const payload = (await this.platformPayload('sendgrid')) as SendGridPlatformPayload | null;
    if (!payload?.apiKey) {
      throw new BadRequestException('SendGrid platform credentials are not configured');
    }
    try {
      const fromEmail = dto.fromEmail ? email(dto.fromEmail, 'From email') : null;
      const toEmail = dto.toEmail ? email(dto.toEmail, 'Test recipient') : null;
      if (toEmail && !fromEmail) {
        throw new BadRequestException('A verified from email is required to send a test');
      }
      if (fromEmail && toEmail) {
        const send = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${payload.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: toEmail }] }],
            from: { email: fromEmail },
            subject: 'RealtyTechAI platform test',
            content: [{ type: 'text/plain', value: 'Your platform SendGrid connection is working.' }],
          }),
        });
        if (!send.ok) {
          const detail = await send.text().catch(() => '');
          throw new Error(`SendGrid test email failed (${send.status}): ${detail}`);
        }
      } else {
        const response = await fetch('https://api.sendgrid.com/v3/user/profile', {
          headers: { Authorization: `Bearer ${payload.apiKey}` },
        });
        if (!response.ok) {
          throw new Error(`SendGrid credential test failed (${response.status})`);
        }
      }
      await this.savePlatformPayload('sendgrid', {
        ...payload,
        configured: true,
        connected: true,
        error: null,
        lastSync: nowIso(),
      });
      return { ok: true };
    } catch (error: any) {
      const message = String(error?.message || 'SendGrid test failed').slice(0, 1000);
      await this.savePlatformPayload('sendgrid', {
        ...payload,
        configured: true,
        connected: false,
        error: message,
        lastSync: nowIso(),
      });
      return { ok: false, error: message };
    }
  }

  async tenantSummary(tenantId: string) {
    const rows = await this.tenantCredentials.find({
      where: { tenant: { id: tenantId } as any },
      relations: ['tenant'],
    });
    const values = new Map(
      rows
        .filter((row) => row.provider === 'twilio' || row.provider === 'sendgrid')
        .map((row) => [row.provider, decryptIntegrationPayload(row.encryptedValue)]),
    );
    const twilio = values.get('twilio');
    const sendgrid = values.get('sendgrid');
    const summary = (payload: any, display: Record<string, unknown>) => ({
      configured: Boolean(payload?.configured),
      connected: Boolean(payload?.connected),
      status: payload?.error
        ? 'error'
        : payload?.connected
          ? 'connected'
          : payload?.configured
            ? 'configured'
            : 'disconnected',
      error: payload?.error || null,
      lastSync: payload?.lastSync || null,
      managedByPlatform: true,
      display,
    });
    return {
      twilio: summary(twilio, { fromNumber: twilio?.fromNumber || null }),
      sendgrid: summary(sendgrid, {
        fromEmail: sendgrid?.fromEmail || null,
        fromName: sendgrid?.fromName || null,
        inboundAddress: sendgrid?.inboundAddress || null,
      }),
    };
  }

  async assignTwilio(tenantId: string, dto: { fromNumber: string }) {
    const platform = (await this.platformPayload('twilio')) as TwilioPlatformPayload | null;
    if (!platform?.accountSid || !platform?.authToken) {
      throw new BadRequestException('Save the platform Twilio credentials first');
    }
    const fromNumber = normalizePhoneE164(dto.fromNumber);
    if (!fromNumber) throw new BadRequestException('Twilio phone number is invalid');
    await this.saveTenantPayload(
      tenantId,
      'twilio',
      {
        configured: true,
        connected: false,
        managedByPlatform: true,
        accountSid: platform.accountSid,
        authToken: platform.authToken,
        fromNumber,
        lastSync: nowIso(),
        error: null,
      },
      fromNumber,
    );
    return this.tenantSummary(tenantId);
  }

  async assignSendGrid(
    tenantId: string,
    dto: { fromEmail: string; fromName?: string; inboundAddress?: string },
  ) {
    const platform = (await this.platformPayload('sendgrid')) as SendGridPlatformPayload | null;
    if (!platform?.apiKey) {
      throw new BadRequestException('Save the platform SendGrid API key first');
    }
    const fromEmail = email(dto.fromEmail, 'From email');
    const inboundAddress = dto.inboundAddress
      ? email(dto.inboundAddress, 'Inbound address')
      : null;
    await this.saveTenantPayload(
      tenantId,
      'sendgrid',
      {
        configured: true,
        connected: false,
        managedByPlatform: true,
        apiKey: platform.apiKey,
        fromEmail,
        fromName: String(dto.fromName || '').trim() || 'RealtyTechAI',
        inboundAddress,
        lastSync: nowIso(),
        error: null,
      },
      inboundAddress,
    );
    return this.tenantSummary(tenantId);
  }

  async testTenantTwilio(
    tenantId: string,
    dto: { toNumber?: string; message?: string },
  ) {
    const row = await this.tenantRow(tenantId, 'twilio');
    const payload = row ? decryptIntegrationPayload(row.encryptedValue) : null;
    if (!row || !payload?.fromNumber) {
      throw new BadRequestException('Assign a Twilio number to this client first');
    }
    const result = await this.testPlatformTwilio({
      fromNumber: payload.fromNumber,
      toNumber: dto.toNumber,
      message: dto.message,
    });
    await this.saveTenantPayload(
      tenantId,
      'twilio',
      {
        ...payload,
        connected: result.ok,
        configured: true,
        error: result.ok ? null : result.error || 'Twilio test failed',
        lastSync: nowIso(),
      },
      row.routingKey || payload.fromNumber,
    );
    return result;
  }

  async testTenantSendGrid(tenantId: string, dto: { toEmail?: string }) {
    const row = await this.tenantRow(tenantId, 'sendgrid');
    const payload = row ? decryptIntegrationPayload(row.encryptedValue) : null;
    if (!row || !payload?.fromEmail) {
      throw new BadRequestException('Assign a SendGrid sender to this client first');
    }
    const result = await this.testPlatformSendGrid({
      fromEmail: payload.fromEmail,
      toEmail: dto.toEmail,
    });
    await this.saveTenantPayload(
      tenantId,
      'sendgrid',
      {
        ...payload,
        connected: result.ok,
        configured: true,
        error: result.ok ? null : result.error || 'SendGrid test failed',
        lastSync: nowIso(),
      },
      row.routingKey || payload.inboundAddress || null,
    );
    return result;
  }

  async removeTenantProvider(tenantId: string, provider: ManagedMessagingProvider) {
    const row = await this.tenantRow(tenantId, provider);
    if (row) await this.tenantCredentials.remove(row);
    return { ok: true };
  }

  async removePlatformProvider(provider: ManagedMessagingProvider) {
    const row = await this.platformRow(provider);
    if (row) await this.platformCredentials.remove(row);
    const tenantRows = await this.tenantCredentials.find({ where: { provider } });
    for (const tenantRow of tenantRows) {
      const payload = decryptIntegrationPayload(tenantRow.encryptedValue) || {};
      const sanitized = { ...payload };
      if (provider === 'twilio') {
        delete sanitized.accountSid;
        delete sanitized.authToken;
      } else {
        delete sanitized.apiKey;
      }
      tenantRow.encryptedValue = encryptPayload({
        ...sanitized,
        configured: false,
        connected: false,
        managedByPlatform: true,
        error: 'Platform provider credentials were removed',
        lastSync: nowIso(),
      });
      await this.tenantCredentials.save(tenantRow);
    }
    return { ok: true };
  }
}
