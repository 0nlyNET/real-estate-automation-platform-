import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { Repository } from 'typeorm';
import { normalizePhoneE164 } from '../../common/phone';
import { Credential } from '../settings/credential.entity';
import { decryptIntegrationPayload } from './integrations.service';
import { PlatformCredential } from './platform-credential.entity';
import { OnboardingService } from '../onboarding/onboarding.service';
import { sanitizeOperationalText } from '../../common/operational-log';
import { TenantMessagingResource } from './tenant-messaging-resource.entity';
import { TenantEmailIdentity } from './tenant-email-identity.entity';
import { TwilioProvisioningService } from './twilio-provisioning.service';
import { EmailIdentityService } from './email-identity.service';
import { ProviderConfigService } from './provider-config.service';
import { sendSendGridEmail, sendTwilioSms } from '../../common/providers';

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
    @Optional() private readonly onboarding?: OnboardingService,
    @Optional()
    @InjectRepository(TenantMessagingResource)
    private readonly messagingResources?: Repository<TenantMessagingResource>,
    @Optional()
    @InjectRepository(TenantEmailIdentity)
    private readonly emailIdentities?: Repository<TenantEmailIdentity>,
    @Optional() private readonly twilioProvisioning?: TwilioProvisioningService,
    @Optional() private readonly emailIdentityService?: EmailIdentityService,
    @Optional() private readonly providerConfig?: ProviderConfigService,
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
    const previous = (await this.platformPayload('twilio')) as TwilioPlatformPayload | null;
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
    if (
      previous?.accountSid &&
      previous.accountSid !== accountSid &&
      this.messagingResources
    ) {
      const resources = await this.messagingResources.find();
      for (const resource of resources) {
        resource.smsStatus = 'blocked';
        resource.lastError = 'Twilio parent account changed; ownership reconciliation is required';
        await this.messagingResources.save(resource);
        await this.onboarding?.invalidateLaunchEvidence(resource.tenantId, {
          reason: 'Platform Twilio parent account changed',
          retestMessaging: true,
        });
      }
    }
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
    if (this.emailIdentities) {
      const identities = await this.emailIdentities.find();
      for (const identity of identities) {
        identity.emailStatus = 'testing';
        identity.lastVerifiedAt = null;
        identity.lastError = 'Retest after platform SendGrid key changed';
        await this.emailIdentities.save(identity);
        await this.onboarding?.invalidateLaunchEvidence(identity.tenantId, {
          reason: 'Platform SendGrid credential changed',
          retestMessaging: true,
        });
      }
    }
    return this.platformSummary();
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
      const message = sanitizeOperationalText(
        error?.message || 'Twilio test failed',
      );
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
      const message = sanitizeOperationalText(
        error?.message || 'SendGrid test failed',
      );
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
    if (this.messagingResources && this.emailIdentities) {
      const [twilio, sendgrid] = await Promise.all([
        this.messagingResources.findOne({ where: { tenantId } }),
        this.emailIdentities.findOne({ where: { tenantId } }),
      ]);
      return {
        twilio: {
          configured: Boolean(twilio?.twilioSubaccountSid),
          connected: twilio?.smsStatus === 'ready',
          status: twilio?.smsStatus || 'disconnected',
          error: twilio?.lastError || null,
          lastSync: twilio?.updatedAt || null,
          managedByPlatform: true,
          display: {
            fromNumber: twilio?.phoneNumber || null,
            complianceStatus: twilio?.a2pComplianceStatus || 'not_started',
            customerProfileSid: twilio?.a2pCustomerProfileSid || null,
            brandSid: twilio?.a2pBrandSid || null,
            campaignSid: twilio?.a2pCampaignSid || null,
          },
        },
        sendgrid: {
          configured: Boolean(sendgrid),
          connected: sendgrid?.emailStatus === 'ready',
          status: sendgrid?.emailStatus || 'disconnected',
          error: sendgrid?.lastError || null,
          lastSync: sendgrid?.updatedAt || null,
          managedByPlatform: true,
          display: {
            fromEmail: sendgrid?.fromEmail || null,
            fromName: sendgrid?.fromName || null,
            inboundAddress: sendgrid?.inboundAddress || null,
            reputationStatus: sendgrid?.reputationStatus || null,
          },
        },
      };
    }
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
    void dto;
    if (!this.twilioProvisioning) {
      throw new BadRequestException('Managed Twilio provisioning service is unavailable');
    }
    await this.twilioProvisioning.provisionTenant(tenantId);
    const legacy = await this.tenantRow(tenantId, 'twilio');
    if (legacy) await this.tenantCredentials.remove(legacy);
    await this.onboarding?.invalidateLaunchEvidence(tenantId, {
      reason: 'Managed Twilio resources were provisioned or reconciled',
      retestMessaging: true,
      twilioApproval: false,
    });
    return this.tenantSummary(tenantId);
  }

  async assignSendGrid(
    tenantId: string,
    dto: { fromEmail: string; fromName?: string; inboundAddress?: string },
  ) {
    if (!this.emailIdentityService) {
      throw new BadRequestException('Managed SendGrid identity service is unavailable');
    }
    await this.emailIdentityService.provisionTenant(tenantId, {
      fromName: dto.fromName,
    });
    const legacy = await this.tenantRow(tenantId, 'sendgrid');
    if (legacy) await this.tenantCredentials.remove(legacy);
    await this.onboarding?.invalidateLaunchEvidence(tenantId, {
      reason: 'Managed SendGrid identity was provisioned or reconciled',
      retestMessaging: true,
      sendgridApproval: false,
    });
    return this.tenantSummary(tenantId);
  }

  async testTenantTwilio(
    tenantId: string,
    dto: { toNumber?: string; message?: string },
  ) {
    if (this.providerConfig && this.twilioProvisioning) {
      const config = await this.providerConfig.resolveTwilio(tenantId, {
        allowTesting: true,
      });
      if (!config) {
        throw new BadRequestException(
          'Managed Twilio resources are not ready for controlled testing',
        );
      }
      const to = dto.toNumber ? normalizePhoneE164(dto.toNumber) : null;
      if (!to) throw new BadRequestException('A test recipient number is required');
      try {
        await sendTwilioSms({
          accountSid: config.accountSid,
          authToken: config.authToken,
          authUsername: config.authUsername,
          to,
          body: String(dto.message || 'RealtyTechAI controlled SMS test'),
          statusCallback: String(process.env.TWILIO_STATUS_CALLBACK_URL || ''),
          ...(config.messagingServiceSid
            ? { messagingServiceSid: config.messagingServiceSid }
            : { from: config.fromNumber as string }),
        });
        await this.twilioProvisioning.markValidated(tenantId);
        return { ok: true };
      } catch (error: any) {
        return { ok: false, error: sanitizeOperationalText(error?.message || 'Twilio test failed') };
      }
    }
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
    if (this.providerConfig && this.emailIdentityService) {
      const config = await this.providerConfig.resolveSendGrid(tenantId, {
        allowTesting: true,
      });
      if (!config) {
        throw new BadRequestException(
          'Managed SendGrid identity is not ready for controlled testing',
        );
      }
      const to = dto.toEmail ? email(dto.toEmail, 'Test recipient') : null;
      if (!to) throw new BadRequestException('A test recipient email is required');
      try {
        await sendSendGridEmail({
          apiKey: config.apiKey,
          to,
          fromEmail: config.fromEmail,
          fromName: config.fromName,
          replyTo: config.inboundAddress,
          subject: `${config.fromName} controlled email test`,
          text: 'This is a controlled RealtyTechAI email delivery test.',
          categories: ['transactional'],
        });
        await this.emailIdentityService.markVerified(tenantId);
        return { ok: true };
      } catch (error: any) {
        return { ok: false, error: sanitizeOperationalText(error?.message || 'SendGrid test failed') };
      }
    }
    const row = await this.tenantRow(tenantId, 'sendgrid');
    const payload = row ? decryptIntegrationPayload(row.encryptedValue) : null;
    if (!row || !payload?.fromEmail) {
      throw new BadRequestException('Assign a SendGrid sender to this client first');
    }
    if (!payload?.apiKey) {
      throw new BadRequestException('Platform SendGrid credentials are not available');
    }

    let result: { ok: boolean; error?: string };
    try {
      const fromEmail = email(payload.fromEmail, 'From email');
      const toEmail = dto.toEmail ? email(dto.toEmail, 'Test recipient') : null;
      const fromName = String(payload.fromName || '').trim();
      if (!fromName) {
        throw new BadRequestException('Client sender name is required');
      }
      const replyTo = email(
        payload.inboundAddress,
        'Inbound reply address',
      );

      if (toEmail) {
        const send = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${payload.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: toEmail }] }],
            from: { email: fromEmail, name: fromName },
            reply_to: { email: replyTo, name: fromName },
            subject: `${fromName} email connection test`,
            content: [
              {
                type: 'text/plain',
                value: `This is a controlled email delivery test for ${fromName}. Replies to this message are routed to ${replyTo}.`,
              },
            ],
          }),
        });
        if (!send.ok) {
          const detail = await send.text().catch(() => '');
          throw new Error(`SendGrid client test email failed (${send.status}): ${detail}`);
        }
      } else {
        const response = await fetch('https://api.sendgrid.com/v3/user/profile', {
          headers: { Authorization: `Bearer ${payload.apiKey}` },
        });
        if (!response.ok) {
          throw new Error(`SendGrid credential test failed (${response.status})`);
        }
      }
      result = { ok: true };
    } catch (error: any) {
      result = {
        ok: false,
        error: sanitizeOperationalText(
          error?.message || 'SendGrid client test failed',
        ),
      };
    }

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
    if (provider === 'twilio' && this.messagingResources) {
      const resource = await this.messagingResources.findOne({ where: { tenantId } });
      if (resource) {
        resource.smsStatus = 'blocked';
        resource.lastError = 'Managed SMS was disabled by a platform operator';
        await this.messagingResources.save(resource);
      }
    }
    if (provider === 'sendgrid' && this.emailIdentities) {
      const identity = await this.emailIdentities.findOne({ where: { tenantId } });
      if (identity) {
        identity.emailStatus = 'blocked';
        identity.reputationStatus = 'paused';
        identity.lastError = 'Managed email was disabled by a platform operator';
        await this.emailIdentities.save(identity);
      }
    }
    const row = await this.tenantRow(tenantId, provider);
    if (row) {
      await this.tenantCredentials.remove(row);
      await this.onboarding?.invalidateLaunchEvidence(tenantId, {
        reason: `Client ${provider} assignment was removed`,
        retestMessaging: true,
        twilioApproval: provider === 'twilio',
        sendgridApproval: provider === 'sendgrid',
      });
    }
    return { ok: true };
  }

  async removePlatformProvider(provider: ManagedMessagingProvider) {
    const row = await this.platformRow(provider);
    if (row) await this.platformCredentials.remove(row);
    if (provider === 'twilio' && this.messagingResources) {
      const resources = await this.messagingResources.find();
      for (const resource of resources) {
        resource.smsStatus = 'blocked';
        resource.lastError = 'Platform Twilio credentials were removed';
        await this.messagingResources.save(resource);
        await this.onboarding?.invalidateLaunchEvidence(resource.tenantId, {
          reason: 'Platform Twilio credentials were removed',
          retestMessaging: true,
        });
      }
    }
    if (provider === 'sendgrid' && this.emailIdentities) {
      const identities = await this.emailIdentities.find();
      for (const identity of identities) {
        identity.emailStatus = 'blocked';
        identity.lastError = 'Platform SendGrid credentials were removed';
        await this.emailIdentities.save(identity);
        await this.onboarding?.invalidateLaunchEvidence(identity.tenantId, {
          reason: 'Platform SendGrid credentials were removed',
          retestMessaging: true,
        });
      }
    }
    const tenantRows = await this.tenantCredentials.find({
      where: { provider },
      relations: ['tenant'],
    });
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
      if (tenantRow.tenant?.id) {
        await this.onboarding?.invalidateLaunchEvidence(tenantRow.tenant.id, {
          reason: `Platform ${provider} credentials were removed`,
          retestMessaging: true,
        });
      }
    }
    return { ok: true };
  }
}
