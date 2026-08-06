import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';

import { Credential } from '../settings/credential.entity';
import { LeadsService } from '../leads/leads.service';
import { decryptString, encryptString } from '../../common/crypto-secrets';

const PROVIDER = 'realtor_com';

type StoredConfig = {
  configured: boolean;
  connected: boolean;
  apiKey: string;
  loginName: string;
  createdAt: string;
  lastSync: string | null;
  error: string | null;
};

@Injectable()
export class RealtorComService {
  constructor(
    @InjectRepository(Credential)
    private readonly credentials: Repository<Credential>,
    private readonly leads: LeadsService,
  ) {}

  private async findCredential(tenantId: string) {
    return this.credentials.findOne({
      where: { tenant: { id: tenantId } as any, provider: PROVIDER },
      relations: ['tenant'],
    });
  }

  private decode(row: Credential | null): StoredConfig | null {
    if (!row?.encryptedValue) return null;
    try {
      return JSON.parse(decryptString(row.encryptedValue)) as StoredConfig;
    } catch {
      return null;
    }
  }

  private publicBaseUrl() {
    return String(process.env.PUBLIC_API_URL || '').replace(/\/+$/, '');
  }

  private requirePublicBaseUrl() {
    const value = this.publicBaseUrl();
    if (!value) {
      throw new BadRequestException(
        'Realtor.com delivery is unavailable until PUBLIC_API_URL is configured',
      );
    }
    try {
      const url = new URL(value);
      if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
        throw new Error('not https');
      }
    } catch {
      throw new BadRequestException('PUBLIC_API_URL must be an absolute URL');
    }
    return value;
  }

  private endpointPath(_tenantId: string) {
    return '/api/v1/ingest/lead';
  }

  async getSetup(tenantId: string) {
    if (!tenantId) throw new BadRequestException('Missing tenant');
    const row = await this.findCredential(tenantId);
    const config = this.decode(row);
    const baseUrl = this.publicBaseUrl();
    return {
      provider: PROVIDER,
      configured: Boolean(config?.configured),
      connected: Boolean(config?.connected),
      status: config?.error
        ? 'error'
        : config?.connected
          ? 'connected'
          : config?.configured
            ? 'configured'
            : 'disconnected',
      endpointPath: this.endpointPath(tenantId),
      endpointUrl: baseUrl ? `${baseUrl}${this.endpointPath(tenantId)}` : null,
      loginName: config?.loginName || `realtytechai-${tenantId}`,
      apiKeyLast4: config?.apiKey ? config.apiKey.slice(-4) : null,
      lastSync: config?.lastSync || null,
      error: config?.error || null,
    };
  }

  async rotateKey(tenantId: string) {
    if (!tenantId) throw new BadRequestException('Missing tenant');
    const baseUrl = this.requirePublicBaseUrl();
    const apiKey = crypto.randomBytes(32).toString('base64url');
    const loginName = `realtytechai-${tenantId}`;
    const previous = await this.findCredential(tenantId);
    const now = new Date().toISOString();
    const config: StoredConfig = {
      configured: true,
      connected: false,
      apiKey,
      loginName,
      createdAt: now,
      lastSync: null,
      error: null,
    };

    const row =
      previous ||
      this.credentials.create({
        tenant: { id: tenantId } as any,
        provider: PROVIDER,
        routingKey: tenantId,
        encryptedValue: '',
      });
    row.routingKey = tenantId;
    row.ingestionKeyHash = crypto
      .createHash('sha256')
      .update(apiKey, 'utf8')
      .digest('hex');
    row.encryptedValue = encryptString(JSON.stringify(config));
    await this.credentials.save(row);

    return {
      provider: PROVIDER,
      endpointPath: this.endpointPath(tenantId),
      endpointUrl: baseUrl ? `${baseUrl}${this.endpointPath(tenantId)}` : null,
      loginName,
      apiKey,
      apiKeyLast4: apiKey.slice(-4),
      createdAt: now,
      warning: 'Copy the API key now. Rotating it invalidates the previous key immediately.',
    };
  }

  async disconnect(tenantId: string) {
    const row = await this.findCredential(tenantId);
    if (row) await this.credentials.remove(row);
    return { ok: true };
  }

  async receiveLead(
    tenantId: string,
    headers: Record<string, string | string[] | undefined>,
    body: Record<string, unknown>,
  ) {
    const row = await this.findCredential(tenantId);
    const config = this.decode(row);
    if (!row || !config?.configured || !config.apiKey) {
      throw new UnauthorizedException('Realtor.com delivery is not configured');
    }

    const supplied = this.extractApiKey(headers, body);
    if (!supplied || !this.safeEqual(config.apiKey, supplied)) {
      throw new UnauthorizedException('Invalid Realtor.com API key');
    }

    if (this.isConnectionTest(body)) {
      try {
        await this.markConnected(row, config);
        return { success: true, status: 'connected' };
      } catch (error) {
        await this.markError(row, config, error);
        throw error;
      }
    }

    try {
      const payload = this.normalizeLead(body);
      const lead = await this.leads.intake(tenantId, payload as any);
      await this.markConnected(row, config);

      return { success: true, status: 'accepted', leadId: lead.id };
    } catch (error) {
      await this.markError(row, config, error);
      throw error;
    }
  }

  private async markConnected(row: Credential, config: StoredConfig) {
    row.encryptedValue = encryptString(
      JSON.stringify({
        ...config,
        configured: true,
        connected: true,
        lastSync: new Date().toISOString(),
        error: null,
      } satisfies StoredConfig),
    );
    await this.credentials.save(row);
  }

  private async markError(row: Credential, config: StoredConfig, error: unknown) {
    const message = error instanceof Error ? error.message : 'Realtor.com delivery failed';
    row.encryptedValue = encryptString(
      JSON.stringify({
        ...config,
        connected: false,
        error: message.slice(0, 500),
      } satisfies StoredConfig),
    );
    await this.credentials.save(row);
  }

  private extractApiKey(
    headers: Record<string, string | string[] | undefined>,
    body: Record<string, unknown>,
  ) {
    const header = (name: string) => {
      const value = headers[name] ?? headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    };

    const direct = header('x-api-key') || header('x-realtor-api-key');
    if (direct) return String(direct).trim();

    const authorization = String(header('authorization') || '').trim();
    if (/^Bearer\s+/i.test(authorization)) {
      return authorization.replace(/^Bearer\s+/i, '').trim();
    }
    if (/^Basic\s+/i.test(authorization)) {
      try {
        const decoded = Buffer.from(
          authorization.replace(/^Basic\s+/i, ''),
          'base64',
        ).toString('utf8');
        return decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
      } catch {
        return '';
      }
    }

    return String(
      body.apiKey || body.api_key || body.password || body.applicationKey || '',
    ).trim();
  }

  private safeEqual(expected: string, supplied: string) {
    const a = Buffer.from(expected);
    const b = Buffer.from(supplied);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  private isConnectionTest(body: Record<string, unknown>) {
    const type = String(
      body.type || body.event || body.eventType || body.action || '',
    ).toLowerCase();
    return (
      body.test === true ||
      body.isTest === true ||
      ['test', 'ping', 'connection_test', 'verify'].includes(type)
    );
  }

  private normalizeLead(body: Record<string, any>) {
    const root = body.lead || body.contact || body.consumer || body;
    const property = body.property || root.property || body.listing || root.listing || {};

    const firstName = this.first(root.firstName, root.first_name, body.firstName, body.first_name);
    const lastName = this.first(root.lastName, root.last_name, body.lastName, body.last_name);
    const fullName = this.first(
      root.fullName,
      root.full_name,
      root.name,
      body.fullName,
      body.full_name,
      body.name,
      [firstName, lastName].filter(Boolean).join(' '),
    );
    const email = this.first(
      root.email,
      root.emailAddress,
      root.email_address,
      body.email,
      body.emailAddress,
    );
    const phone = this.first(
      root.phone,
      root.phoneNumber,
      root.phone_number,
      root.mobile,
      body.phone,
      body.phoneNumber,
    );

    if (!fullName && !email && !phone) {
      throw new BadRequestException(
        'Realtor.com payload did not include a name, email, or phone number',
      );
    }

    const address = this.first(
      property.address,
      property.fullAddress,
      property.streetAddress,
      property.location,
      body.location,
    );
    const message = this.first(
      root.message,
      root.comments,
      root.comment,
      root.note,
      body.message,
      body.comments,
      body.inquiry,
    );
    const leadType = this.normalizeLeadType(
      this.first(root.leadType, root.lead_type, body.leadType, body.lead_type),
    );

    return {
      fullName: fullName || email || phone || 'Realtor.com lead',
      email: email || undefined,
      phone: phone || undefined,
      source: 'Realtor.com',
      message: message || undefined,
      location: address || undefined,
      propertyInterest:
        this.first(property.mlsNumber, property.mls_number, property.url, property.id) ||
        undefined,
      leadType,
      temperature: 'warm',
      score: 65,
    };
  }

  private first(...values: unknown[]) {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
    return '';
  }

  private normalizeLeadType(value: string) {
    const normalized = String(value || '').toLowerCase();
    if (normalized.includes('sell')) return 'seller';
    if (normalized.includes('rent')) return 'renter';
    if (normalized.includes('invest')) return 'investor';
    return 'buyer';
  }
}
