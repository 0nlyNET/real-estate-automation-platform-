import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { TenantSettings } from '../settings/tenant-settings.entity';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @InjectRepository(TenantSettings)
    private readonly settingsRepo: Repository<TenantSettings>,
  ) {}

  async getOrCreateSettings(tenantId: string): Promise<TenantSettings> {
    // Explicit typing avoids TypeORM overload confusion (array vs single entity).
    let s: TenantSettings | null = await this.settingsRepo.findOne({ where: { tenantId } });
    if (!s) {
      const created = this.settingsRepo.create({ tenantId } as DeepPartial<TenantSettings>);
      s = await this.settingsRepo.save(created);
    }
    return s;
  }

  private hashKey(key: string) {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  async generateZapierKey(tenantId: string): Promise<{ apiKey: string; last4: string }> {
    const settings = await this.getOrCreateSettings(tenantId);
    const apiKey = 'zap_' + crypto.randomBytes(24).toString('hex');
    const last4 = apiKey.slice(-4);

    settings.zapierApiKeyHash = this.hashKey(apiKey);
    settings.zapierApiKeyLast4 = last4;
    await this.settingsRepo.save(settings);

    // Return plaintext key ONCE. Store only hash.
    return { apiKey, last4 };
  }

  async getZapierKeyMeta(tenantId: string): Promise<{ last4?: string }> {
    const settings = await this.getOrCreateSettings(tenantId);
    return { last4: settings.zapierApiKeyLast4 || undefined };
  }

  async setWebhooks(tenantId: string, payload: { url?: string; events?: string[] }) {
    const settings = await this.getOrCreateSettings(tenantId);
    settings.webhookUrl = payload.url || undefined;
    settings.webhookEvents = payload.events?.length ? payload.events : undefined;
    await this.settingsRepo.save(settings);
    return { ok: true };
  }

  async testWebhook(tenantId: string) {
    const settings = await this.getOrCreateSettings(tenantId);
    if (!settings.webhookUrl) return { ok: false, reason: 'No webhook_url configured' };

    const body = {
      event: 'test',
      tenantId,
      at: new Date().toISOString(),
      sample: {
        lead: {
          id: 'lead_demo_123',
          fullName: 'Demo Lead',
          email: 'demo@example.com',
          phone: '+15555550123',
          source: 'Test',
        },
      },
    };

    try {
      const res = await fetch(settings.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { ok: true, status: res.status };
    } catch (e: any) {
      this.logger.warn(`Webhook test failed: ${e?.message || e}`);
      return { ok: false, reason: 'Request failed' };
    }
  }

  async fireWebhook(tenantId: string, event: string, payload: any) {
    const settings = await this.getOrCreateSettings(tenantId);
    if (!settings.webhookUrl) return;
    if (settings.webhookEvents && settings.webhookEvents.length && !settings.webhookEvents.includes(event)) return;

    const body = {
      event,
      tenantId,
      at: new Date().toISOString(),
      payload,
    };

    try {
      await fetch(settings.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      this.logger.warn(`Webhook fire failed (${event}): ${e?.message || e}`);
    }
  }

  async connectFacebookStub(tenantId: string) {
    const settings = await this.getOrCreateSettings(tenantId);
    settings.facebookConnected = true;
    settings.facebookPageName = settings.facebookPageName || 'Connected Page';
    await this.settingsRepo.save(settings);
    return { ok: true, pageName: settings.facebookPageName };
  }

  async listFacebookFormsStub(tenantId: string) {
    const settings = await this.getOrCreateSettings(tenantId);
    if (!settings.facebookConnected) return { forms: [] };
    return {
      forms: [
        { id: 'fb_form_1', name: 'Buyer Inquiry Form' },
        { id: 'fb_form_2', name: 'Open House RSVP' },
        { id: 'fb_form_3', name: 'Home Valuation Request' },
      ],
    };
  }

  async selectFacebookFormStub(tenantId: string, formId: string) {
    const settings = await this.getOrCreateSettings(tenantId);
    settings.facebookFormId = formId;
    await this.settingsRepo.save(settings);
    return { ok: true };
  }
}
