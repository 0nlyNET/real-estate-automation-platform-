import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { Message } from '../messaging/message.entity';

@Injectable()
export class AgencyService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(TenantSettings)
    private readonly settingsRepo: Repository<TenantSettings>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  private async getSettings(tenantId: string) {
    return await this.settingsRepo.findOne({ where: { tenantId } });
  }

  private async getLastMessageAt(tenantId: string) {
    const result = await this.messageRepo
      .createQueryBuilder('message')
      .innerJoin('message.lead', 'lead')
      .where('lead.tenantId = :tenantId', { tenantId })
      .select('MAX(message.createdAt)', 'lastMessageAt')
      .getRawOne<{ lastMessageAt: string | null }>();

    return result?.lastMessageAt ? new Date(result.lastMessageAt).toISOString() : null;
  }

  private async getRecentFailures(tenantId: string) {
    const failures = await this.messageRepo
      .createQueryBuilder('message')
      .innerJoinAndSelect('message.lead', 'lead')
      .where('lead.tenantId = :tenantId', { tenantId })
      .andWhere('message.status = :status', { status: 'failed' })
      .orderBy('message.createdAt', 'DESC')
      .take(5)
      .getMany();

    return failures.map((msg) => ({
      id: msg.id,
      createdAt: msg.createdAt.toISOString(),
      channel: msg.channel,
      error: msg.lastError || 'Unknown error',
      leadName: msg.lead?.fullName,
    }));
  }

  async getHealth(tenant: Tenant) {
    const settings = await this.getSettings(tenant.id);
    const lastMessageAt = await this.getLastMessageAt(tenant.id);

    const twilioConnected = !!settings?.twilioAccountSid && !!(settings?.twilioFromNumber || settings?.twilioMessagingServiceSid);
    const sendgridConnected = !!settings?.sendgridApiKeyEnc;
    const bookingLinkSet = !!settings?.bookingLink;

    return {
      tenantId: tenant.id,
      integrations: {
        twilioConnected,
        sendgridConnected,
        bookingLinkSet,
      },
      billing: {
        plan: tenant.plan,
        status: tenant.status,
        currentPeriodEnd: tenant.currentPeriodEnd ? tenant.currentPeriodEnd.toISOString() : null,
      },
      lastActivityAt: lastMessageAt,
      onboardingStatus: 'not_started',
    };
  }

  async listTenants() {
    const tenants = await this.tenantRepo.find({ order: { name: 'ASC' } });
    const rows = await Promise.all(
      tenants.map(async (tenant) => {
        const health = await this.getHealth(tenant);
        return {
          id: tenant.id,
          name: tenant.name,
          plan: tenant.plan,
          status: tenant.status,
          onboardingStatus: health.onboardingStatus,
          integrations: health.integrations,
          billing: health.billing,
          lastActivityAt: health.lastActivityAt,
        };
      }),
    );

    return rows;
  }

  async getTenantDetail(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) return null;
    const health = await this.getHealth(tenant);
    const recentFailures = await this.getRecentFailures(tenant.id);

    return {
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      status: tenant.status,
      trialEndsAt: tenant.trialEndsAt ? tenant.trialEndsAt.toISOString() : null,
      currentPeriodEnd: tenant.currentPeriodEnd ? tenant.currentPeriodEnd.toISOString() : null,
      health,
      recentFailures,
    };
  }
}
