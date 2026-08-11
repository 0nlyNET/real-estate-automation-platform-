import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { TenantEmailIdentity } from './tenant-email-identity.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class EmailIdentityService {
  constructor(
    @InjectRepository(TenantEmailIdentity)
    private readonly identities: Repository<TenantEmailIdentity>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async provisionTenant(tenantId: string, input?: { fromName?: string; signature?: string }) {
    const existing = await this.identities.findOne({ where: { tenantId } });
    if (existing) return existing;
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('Tenant not found');
    const sendingDomain = requiredDomain('SENDGRID_SENDING_DOMAIN');
    const replyDomain = requiredDomain('SENDGRID_REPLY_DOMAIN');
    const slug = String(tenant.name || tenant.id || 'client')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'client';
    const replyToken = randomBytes(18).toString('base64url').toLowerCase();
    const saved = await this.identities.save(
      this.identities.create({
        tenantId,
        fromEmail: `${slug}@${sendingDomain}`,
        fromName: String(input?.fromName || tenant.name).trim(),
        replyToken,
        inboundAddress: `${replyToken}@${replyDomain}`,
        signature: String(input?.signature || '').trim() || null,
        classification: 'lead_follow_up',
        reputationStatus: 'warming',
        emailStatus: 'testing',
        lastVerifiedAt: null,
        lastError: null,
      }),
    );
    await this.audit?.recordSystemEvent({
      tenantId,
      eventType: 'provider_resource.email_identity_created',
      resourceType: 'tenant_email_identity',
      resourceId: saved.id,
      afterState: {
        fromEmail: saved.fromEmail,
        inboundAddress: saved.inboundAddress,
        emailStatus: saved.emailStatus,
      },
    });
    return saved;
  }

  async markVerified(tenantId: string) {
    const row = await this.identities.findOne({ where: { tenantId } });
    if (!row) throw new BadRequestException('Tenant email identity is not provisioned');
    row.emailStatus = 'ready';
    row.lastVerifiedAt = new Date();
    row.lastError = null;
    const saved = await this.identities.save(row);
    await this.audit?.recordSystemEvent({
      tenantId,
      eventType: 'provider_resource.email_validated',
      resourceType: 'tenant_email_identity',
      resourceId: saved.id,
      afterState: { emailStatus: saved.emailStatus, lastVerifiedAt: saved.lastVerifiedAt },
    });
    return saved;
  }
}

function requiredDomain(name: string) {
  const value = String(process.env[name] || '').trim().toLowerCase();
  if (!value || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) {
    throw new BadRequestException(`${name} must be configured with an authenticated domain`);
  }
  return value;
}
