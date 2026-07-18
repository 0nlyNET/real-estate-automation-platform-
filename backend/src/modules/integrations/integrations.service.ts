import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Credential } from '../settings/credential.entity';
import * as crypto from 'crypto';

export type IntegrationProvider = 'twilio' | 'sendgrid' | 'facebook_lead_ads';
export type IntegrationStatus = 'disconnected' | 'connected' | 'error';

export interface IntegrationSummary {
  provider: IntegrationProvider;
  connected: boolean;
  status: IntegrationStatus;
  lastSync: string | null;
  error: string | null;
  display?: Record<string, any>;
}

function isV1Encrypted(v: string) {
  return typeof v === 'string' && v.startsWith('v1:');
}

function getEncKey(): Buffer {
  const b64 = process.env.INTEGRATIONS_ENCRYPTION_KEY || '';
  if (!b64.trim()) {
    throw new Error('INTEGRATIONS_ENCRYPTION_KEY is missing in backend/.env');
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error('INTEGRATIONS_ENCRYPTION_KEY must decode to 32 bytes (base64 of 32 random bytes)');
  }
  return key;
}

function encryptJson(obj: any): string {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptIntegrationPayload(value: string | null | undefined): any {
  if (!value) return null;

  // Backward compatible: older rows stored plain JSON
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

function nowIso() {
  return new Date().toISOString();
}

function mask(value: string | null | undefined, keepEnd = 4) {
  if (!value) return null;
  const v = String(value);
  if (v.length <= keepEnd) return v;
  return `${'*'.repeat(Math.max(0, v.length - keepEnd))}${v.slice(-keepEnd)}`;
}

@Injectable()
export class IntegrationsService {
  constructor(
    @InjectRepository(Credential)
    private readonly credentialsRepo: Repository<Credential>,
  ) {}

  private async getRow(tenantId: string, provider: IntegrationProvider): Promise<Credential | null> {
    return (
      (await this.credentialsRepo.findOne({
        where: { tenant: { id: tenantId } as any, provider },
        relations: ['tenant'],
      })) || null
    );
  }

  private async getPayload(tenantId: string, provider: IntegrationProvider): Promise<any | null> {
    const row = await this.getRow(tenantId, provider);
    if (!row) return null;
    return decryptIntegrationPayload(row.encryptedValue);
  }

  private async upsertEncrypted(tenantId: string, provider: IntegrationProvider, payload: any) {
    let cred = await this.getRow(tenantId, provider);

    const encryptedValue = encryptJson(payload);

    if (!cred) {
      cred = this.credentialsRepo.create({
        tenant: { id: tenantId } as any,
        provider,
        encryptedValue,
      });
    } else {
      cred.encryptedValue = encryptedValue;
    }

    await this.credentialsRepo.save(cred);
  }

  private async setError(tenantId: string, provider: IntegrationProvider, error: string) {
    const existing = (await this.getPayload(tenantId, provider)) || {};
    await this.upsertEncrypted(tenantId, provider, {
      ...existing,
      connected: false,
      error,
      lastSync: nowIso(),
    });
  }

  async list(tenantId: string): Promise<IntegrationSummary[]> {
    const creds = await this.credentialsRepo.find({
      where: { tenant: { id: tenantId } as any },
      relations: ['tenant'],
    });

    const byProvider = new Map<string, Credential>();
    for (const c of creds) byProvider.set(c.provider, c);

    const providers: IntegrationProvider[] = ['twilio', 'sendgrid', 'facebook_lead_ads'];

    return providers.map((provider) => {
      const row = byProvider.get(provider);
      const parsed = row ? decryptIntegrationPayload(row.encryptedValue) : null;
      const connected = Boolean(parsed && parsed.connected);

      // Return safe display metadata only (never secrets)
      let display: Record<string, any> = {};
      if (provider === 'twilio') {
        display = {
          fromNumber: parsed?.fromNumber || null,
          accountSid: parsed?.accountSid ? mask(parsed.accountSid, 6) : null,
        };
      } else if (provider === 'sendgrid') {
        display = {
          fromEmail: parsed?.fromEmail || null,
          apiKey: parsed?.apiKey ? `${String(parsed.apiKey).slice(0, 6)}...` : null,
        };
      } else if (provider === 'facebook_lead_ads') {
        display = {
          pageId: parsed?.pageId || null,
          lastSync: parsed?.lastSync || null,
        };
      }

      const status: IntegrationStatus = parsed?.error ? 'error' : connected ? 'connected' : 'disconnected';

      return {
        provider,
        connected,
        status,
        lastSync: parsed?.lastSync || null,
        error: parsed?.error || null,
        display,
      };
    });
  }

  async connectTwilio(tenantId: string, dto: { accountSid: string; authToken: string; fromNumber: string }) {
    const accountSid = dto.accountSid?.trim();
    const authToken = dto.authToken?.trim();
    const fromNumber = dto.fromNumber?.trim();

    if (!accountSid || !authToken || !fromNumber) {
      throw new BadRequestException('Missing Twilio credentials');
    }

    await this.upsertEncrypted(tenantId, 'twilio', {
      connected: true,
      accountSid,
      authToken,
      fromNumber,
      lastSync: nowIso(),
      error: null,
    });

    return { ok: true };
  }

  async testTwilio(tenantId: string, dto: { toNumber?: string; message?: string }) {
    const payload = await this.getPayload(tenantId, 'twilio');
    if (!payload?.connected) {
      throw new BadRequestException('Twilio is not connected');
    }

    const accountSid = String(payload.accountSid || '').trim();
    const authToken = String(payload.authToken || '').trim();
    const fromNumber = String(payload.fromNumber || '').trim();

    if (!accountSid || !authToken || !fromNumber) {
      throw new BadRequestException('Twilio credentials are missing');
    }

    try {
      // Basic credential validation: fetch account details
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
        },
      });

      if (!r.ok) {
        const t = await r.text().catch(() => '');
        const msg = `Twilio test failed (${r.status}): ${t || 'Unauthorized or invalid credentials'}`;
        await this.setError(tenantId, 'twilio', msg);
        return { ok: false, error: msg };
      }

      // Optional: send a test SMS (only if toNumber provided)
      const toNumber = dto.toNumber?.trim();
      if (toNumber) {
        const body = dto.message?.trim() || 'RealtyTechAI test message';
        const form = new URLSearchParams();
        form.set('From', fromNumber);
        form.set('To', toNumber);
        form.set('Body', body);

        const s = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        });

        if (!s.ok) {
          const st = await s.text().catch(() => '');
          const msg = `Twilio send failed (${s.status}): ${st || 'Could not send test message'}`;
          await this.setError(tenantId, 'twilio', msg);
          return { ok: false, error: msg };
        }
      }

      await this.upsertEncrypted(tenantId, 'twilio', {
        ...payload,
        connected: true,
        error: null,
        lastSync: nowIso(),
      });

      return { ok: true };
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : 'Twilio test failed';
      await this.setError(tenantId, 'twilio', msg);
      return { ok: false, error: msg };
    }
  }

  async connectSendGrid(tenantId: string, dto: { apiKey: string; fromEmail?: string }) {
    const apiKey = dto.apiKey?.trim();
    const fromEmail = dto.fromEmail?.trim() || null;

    if (!apiKey) {
      throw new BadRequestException('Missing SendGrid API key');
    }

    await this.upsertEncrypted(tenantId, 'sendgrid', {
      connected: true,
      apiKey,
      fromEmail,
      lastSync: nowIso(),
      error: null,
    });

    return { ok: true };
  }

  async testSendGrid(tenantId: string, dto: { toEmail?: string }) {
    const payload = await this.getPayload(tenantId, 'sendgrid');
    if (!payload?.connected) {
      throw new BadRequestException('SendGrid is not connected');
    }

    const apiKey = String(payload.apiKey || '').trim();
    const fromEmail = String(payload.fromEmail || '').trim();

    if (!apiKey) throw new BadRequestException('SendGrid API key missing');

    try {
      // Basic validation: fetch profile
      const r = await fetch('https://api.sendgrid.com/v3/user/profile', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!r.ok) {
        const t = await r.text().catch(() => '');
        const msg = `SendGrid test failed (${r.status}): ${t || 'Unauthorized or invalid key'}`;
        await this.setError(tenantId, 'sendgrid', msg);
        return { ok: false, error: msg };
      }

      // Optional: send a test email (only if toEmail and fromEmail exist)
      const toEmail = dto.toEmail?.trim();
      if (toEmail && fromEmail) {
        const send = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: toEmail }] }],
            from: { email: fromEmail },
            subject: 'RealtyTechAI test email',
            content: [{ type: 'text/plain', value: 'Your SendGrid connection is working.' }],
          }),
        });

        if (!send.ok) {
          const st = await send.text().catch(() => '');
          const msg = `SendGrid send failed (${send.status}): ${st || 'Could not send test email'}`;
          await this.setError(tenantId, 'sendgrid', msg);
          return { ok: false, error: msg };
        }
      }

      await this.upsertEncrypted(tenantId, 'sendgrid', {
        ...payload,
        connected: true,
        error: null,
        lastSync: nowIso(),
      });

      return { ok: true };
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : 'SendGrid test failed';
      await this.setError(tenantId, 'sendgrid', msg);
      return { ok: false, error: msg };
    }
  }

  // Manual connect kept (for advanced users)
  async connectFacebookLeadAdsManual(tenantId: string, dto: { pageId: string; accessToken: string; verifyToken?: string }) {
    const pageId = dto.pageId?.trim();
    const accessToken = dto.accessToken?.trim();
    const verifyToken = dto.verifyToken?.trim() || crypto.randomBytes(16).toString('hex');

    if (!pageId || !accessToken) {
      throw new BadRequestException('Missing Facebook Lead Ads credentials');
    }

    await this.upsertEncrypted(tenantId, 'facebook_lead_ads', {
      connected: true,
      pageId,
      accessToken,
      verifyToken,
      lastSync: nowIso(),
      error: null,
    });

    return { ok: true, verifyToken };
  }

  // OAuth start: returns URL for frontend to redirect the user to Facebook consent screen
  async facebookOAuthStart(tenantId: string) {
    const appId = (process.env.FACEBOOK_APP_ID || '').trim();
    const redirectUrl = (process.env.FACEBOOK_REDIRECT_URL || '').trim();

    if (!appId || !redirectUrl) {
      throw new BadRequestException('Facebook OAuth is not configured (FACEBOOK_APP_ID / FACEBOOK_REDIRECT_URL)');
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const state = `${tenantId}.${nonce}`;

    // Save pending state so callback can validate it
    const existing = (await this.getPayload(tenantId, 'facebook_lead_ads')) || {};
    await this.upsertEncrypted(tenantId, 'facebook_lead_ads', {
      ...existing,
      pendingState: state,
      pendingStateAt: nowIso(),
    });

    const scopes = [
      'pages_show_list',
      'pages_read_engagement',
      'leads_retrieval',
      'pages_manage_metadata',
    ].join(',');

    const url =
      'https://www.facebook.com/v19.0/dialog/oauth' +
      `?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
      `&state=${encodeURIComponent(state)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes)}`;

    return { url };
  }

  // OAuth callback: exchange code -> token, store token. Page selection is next step.
  async facebookOAuthCallback(code: string, state: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const appId = (process.env.FACEBOOK_APP_ID || '').trim();
      const appSecret = (process.env.FACEBOOK_APP_SECRET || '').trim();
      const redirectUrl = (process.env.FACEBOOK_REDIRECT_URL || '').trim();

      if (!appId || !appSecret || !redirectUrl) {
        return { ok: false, error: 'Facebook OAuth not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET / FACEBOOK_REDIRECT_URL)' };
      }

      if (!code || !state || !state.includes('.')) {
        return { ok: false, error: 'Invalid Facebook callback payload' };
      }

      const tenantId = state.split('.')[0];

      const existing = await this.getPayload(tenantId, 'facebook_lead_ads');
      const pendingAt = existing?.pendingStateAt ? new Date(existing.pendingStateAt).getTime() : 0;
      if (!existing?.pendingState || existing.pendingState !== state || Date.now() - pendingAt > 10 * 60 * 1000) {
        return { ok: false, error: 'Facebook state mismatch. Please retry connect.' };
      }

      const tokenUrl =
        'https://graph.facebook.com/v19.0/oauth/access_token' +
        `?client_id=${encodeURIComponent(appId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUrl)}` +
        `&client_secret=${encodeURIComponent(appSecret)}` +
        `&code=${encodeURIComponent(code)}`;

      const r = await fetch(tokenUrl, { method: 'GET' });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        const msg = t || `Facebook token exchange failed (${r.status})`;
        await this.setError(tenantId, 'facebook_lead_ads', msg);
        return { ok: false, error: msg };
      }

      const data: any = await r.json().catch(() => ({}));
      const accessToken = data?.access_token ? String(data.access_token) : null;

      if (!accessToken) {
        const msg = 'Facebook token exchange returned no access_token';
        await this.setError(tenantId, 'facebook_lead_ads', msg);
        return { ok: false, error: msg };
      }

      // For MVP: store token. PageId and webhook subscription wiring is next step.
      await this.upsertEncrypted(tenantId, 'facebook_lead_ads', {
        connected: true,
        pageId: null,
        accessToken,
        verifyToken: existing?.verifyToken || crypto.randomBytes(16).toString('hex'),
        lastSync: nowIso(),
        error: null,
        pendingState: null,
        pendingStateAt: null,
      });

      return { ok: true };
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : 'Facebook token exchange failed';
      // Try to derive tenantId from state
      const tenantId = state?.includes('.') ? state.split('.')[0] : null;
      if (tenantId) await this.setError(tenantId, 'facebook_lead_ads', msg);
      return { ok: false, error: msg };
    }
  }

  async disconnect(tenantId: string, provider: IntegrationProvider) {
    await this.upsertEncrypted(tenantId, provider, {
      connected: false,
      lastSync: null,
      error: null,
    });

    return { ok: true };
  }

}
