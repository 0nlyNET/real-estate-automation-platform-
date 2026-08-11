import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { decryptString, encryptString } from '../../common/crypto-secrets';
import { sanitizeOperationalText } from '../../common/operational-log';
import { Tenant } from '../tenants/tenant.entity';
import { decryptIntegrationPayload } from './integrations.service';
import { PlatformCredential } from './platform-credential.entity';
import { TenantMessagingResource } from './tenant-messaging-resource.entity';
import { AuditService } from '../audit/audit.service';

type TwilioJson = Record<string, any>;

@Injectable()
export class TwilioProvisioningService {
  private readonly logger = new Logger(TwilioProvisioningService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TenantMessagingResource)
    private readonly resources: Repository<TenantMessagingResource>,
    @InjectRepository(PlatformCredential)
    private readonly platformCredentials: Repository<PlatformCredential>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async provisionTenant(tenantId: string) {
    if (!this.dataSource?.createQueryRunner) {
      return this.provisionTenantUnlocked(tenantId);
    }
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    const lock = `tenant-provider-provisioning:${tenantId}`;
    try {
      await runner.query('SELECT pg_advisory_lock(hashtext($1))', [lock]);
      return await this.provisionTenantUnlocked(tenantId);
    } finally {
      await runner
        .query('SELECT pg_advisory_unlock(hashtext($1))', [lock])
        .catch(() => undefined);
      await runner.release();
    }
  }

  private async provisionTenantUnlocked(tenantId: string) {
    const tenant = await this.tenants.findOne({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException('Tenant not found');
    const platformRow = await this.platformCredentials.findOne({ where: { provider: 'twilio' } });
    const platform = platformRow ? decryptIntegrationPayload(platformRow.encryptedValue) : null;
    if (!platform?.accountSid || !platform?.authToken) {
      throw new BadRequestException('Platform Twilio credentials are not configured');
    }

    const owner = `provision:${process.env.HOSTNAME || process.pid}:${randomUUID()}`;
    let row = await this.resources.findOne({ where: { tenantId } });
    if (!row) {
      row = await this.resources.save(this.resources.create({
        tenantId,
        twilioParentAccountSid: null,
        twilioSubaccountSid: null,
        twilioApiKeySid: null,
        encryptedApiSecret: null,
        encryptedAuthToken: null,
        messagingServiceSid: null,
        phoneNumberSid: null,
        phoneNumber: null,
        a2pCustomerProfileSid: null,
        a2pTrustProductSid: null,
        a2pBrandSid: null,
        a2pCampaignSid: null,
        a2pComplianceStatus: 'not_started',
        a2pProviderStatus: null,
        a2pRejectionReason: null,
        a2pLastCheckedAt: null,
        a2pNextPollAt: null,
        smsStatus: 'pending',
        smsLastVerifiedAt: null,
        provisioningStep: 'created',
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      }));
    }
    if (row.leaseExpiresAt && row.leaseExpiresAt > new Date() && row.leaseOwner !== owner) {
      return row;
    }
    row.leaseOwner = owner;
    row.leaseExpiresAt = new Date(Date.now() + 10 * 60_000);
    row.smsStatus = 'provisioning';
    row.lastError = null;
    await this.resources.save(row);

    try {
      const ownershipName = `RealtyTechAI tenant ${tenant.id}`;
      if (
        row.twilioParentAccountSid &&
        row.twilioParentAccountSid !== platform.accountSid
      ) {
        throw new Error(
          'Stored Twilio subaccount belongs to a different parent account; owner reconciliation is required',
        );
      }
      if (!row.twilioSubaccountSid) {
        const accounts = await twilioRequest(
          'https://api.twilio.com/2010-04-01/Accounts.json?PageSize=1000',
          platform.accountSid,
          platform.authToken,
        );
        let created = findNamedResource(accounts.accounts, ownershipName);
        if (!created) {
          created = await twilioRequest(
            'https://api.twilio.com/2010-04-01/Accounts.json',
            platform.accountSid,
            platform.authToken,
            { FriendlyName: ownershipName },
          );
        }
        if (!created.auth_token && created.sid) {
          created = await twilioRequest(
            `https://api.twilio.com/2010-04-01/Accounts/${created.sid}.json`,
            platform.accountSid,
            platform.authToken,
          );
        }
        row.twilioSubaccountSid = String(created.sid);
        row.twilioParentAccountSid = String(platform.accountSid);
        row.encryptedAuthToken = encryptString(String(created.auth_token));
        row.provisioningStep = 'subaccount_created';
        await this.resources.save(row);
        await this.audit?.recordSystemEvent({
          tenantId,
          eventType: 'provider_resource.twilio_subaccount_created',
          resourceType: 'tenant_messaging_resource',
          resourceId: row.id,
          afterState: { twilioSubaccountSid: row.twilioSubaccountSid },
        });
      }
      const subaccountToken = row.encryptedAuthToken
        ? decryptString(row.encryptedAuthToken)
        : null;
      if (!subaccountToken) throw new Error('Twilio subaccount auth token is unavailable');

      if (!row.twilioApiKeySid) {
        const keys = await twilioRequest(
          `https://api.twilio.com/2010-04-01/Accounts/${row.twilioSubaccountSid}/Keys.json?PageSize=1000`,
          row.twilioSubaccountSid,
          subaccountToken,
        );
        const unusableKey = findNamedResource(keys.keys, ownershipName);
        // Twilio returns an API-key secret only once. If a process crashed after
        // creation but before persistence, remove that unusable orphan before
        // creating its replacement so reconciliation never accumulates keys.
        if (unusableKey?.sid) {
          await twilioDelete(
            `https://api.twilio.com/2010-04-01/Accounts/${row.twilioSubaccountSid}/Keys/${unusableKey.sid}.json`,
            row.twilioSubaccountSid,
            subaccountToken,
          );
        }
        const key = await twilioRequest(
          `https://api.twilio.com/2010-04-01/Accounts/${row.twilioSubaccountSid}/Keys.json`,
          row.twilioSubaccountSid,
          subaccountToken,
          { FriendlyName: ownershipName },
        );
        row.twilioApiKeySid = String(key.sid);
        row.encryptedApiSecret = encryptString(String(key.secret));
        row.provisioningStep = 'scoped_key_created';
        await this.resources.save(row);
      }
      if (!row.messagingServiceSid) {
        const services = await twilioRequest(
          'https://messaging.twilio.com/v1/Services?PageSize=1000',
          row.twilioSubaccountSid,
          subaccountToken,
        );
        const service =
          findNamedResource(services.services, ownershipName) ||
          (await twilioRequest(
            'https://messaging.twilio.com/v1/Services',
            row.twilioSubaccountSid,
            subaccountToken,
            { FriendlyName: ownershipName },
          ));
        row.messagingServiceSid = String(service.sid);
        row.provisioningStep = 'messaging_service_created';
        await this.resources.save(row);
      }
      if (!row.phoneNumberSid) {
        const ownedNumbers = await twilioRequest(
          `https://api.twilio.com/2010-04-01/Accounts/${row.twilioSubaccountSid}/IncomingPhoneNumbers.json?PageSize=1000`,
          row.twilioSubaccountSid,
          subaccountToken,
        );
        const ownedNumber = findNamedResource(
          ownedNumbers.incoming_phone_numbers,
          ownershipName,
        );
        if (ownedNumber) {
          row.phoneNumberSid = String(ownedNumber.sid);
          row.phoneNumber = String(ownedNumber.phone_number);
          row.provisioningStep = 'number_purchased';
          await this.resources.save(row);
        }
      }
      if (!row.phoneNumberSid) {
        const country = String(process.env.TWILIO_DEFAULT_COUNTRY || 'US').toUpperCase();
        const areaCode = String(process.env.TWILIO_DEFAULT_AREA_CODE || '').trim();
        const query = new URLSearchParams({ SmsEnabled: 'true', PageSize: '20' });
        if (areaCode) query.set('AreaCode', areaCode);
        const available = await twilioRequest(
          `https://api.twilio.com/2010-04-01/Accounts/${row.twilioSubaccountSid}/AvailablePhoneNumbers/${country}/Local.json?${query}`,
          row.twilioSubaccountSid,
          subaccountToken,
        );
        const candidate = available.available_phone_numbers?.[0]?.phone_number;
        if (!candidate) throw new Error('No SMS-capable Twilio number is available');
        const purchased = await twilioRequest(
          `https://api.twilio.com/2010-04-01/Accounts/${row.twilioSubaccountSid}/IncomingPhoneNumbers.json`,
          row.twilioSubaccountSid,
          subaccountToken,
          { PhoneNumber: candidate, FriendlyName: ownershipName },
        );
        row.phoneNumberSid = String(purchased.sid);
        row.phoneNumber = String(purchased.phone_number);
        row.provisioningStep = 'number_purchased';
        await this.resources.save(row);
        await this.audit?.recordSystemEvent({
          tenantId,
          eventType: 'provider_resource.phone_number_created',
          resourceType: 'tenant_messaging_resource',
          resourceId: row.id,
          afterState: { phoneNumberSid: row.phoneNumberSid, phoneNumber: row.phoneNumber },
        });
      }
      if (row.provisioningStep === 'number_purchased') {
        const attached = await twilioRequest(
          `https://messaging.twilio.com/v1/Services/${row.messagingServiceSid}/PhoneNumbers?PageSize=1000`,
          row.twilioSubaccountSid,
          subaccountToken,
        );
        const alreadyAttached = Array.isArray(attached.phone_numbers) &&
          attached.phone_numbers.some((item: TwilioJson) =>
            String(item.phone_number_sid || item.sid) === String(row.phoneNumberSid));
        if (!alreadyAttached) {
          await twilioRequest(
            `https://messaging.twilio.com/v1/Services/${row.messagingServiceSid}/PhoneNumbers`,
            row.twilioSubaccountSid,
            subaccountToken,
            { PhoneNumberSid: row.phoneNumberSid },
          );
        }
        row.provisioningStep = 'number_attached';
        await this.resources.save(row);
      }
      const inboundUrl = requiredUrl('TWILIO_WEBHOOK_URL');
      const statusUrl = requiredUrl('TWILIO_STATUS_CALLBACK_URL');
      await twilioRequest(
        `https://messaging.twilio.com/v1/Services/${row.messagingServiceSid}`,
        row.twilioSubaccountSid,
        subaccountToken,
        { InboundRequestUrl: inboundUrl, InboundMethod: 'POST', StatusCallback: statusUrl },
      );
      row.provisioningStep = 'callbacks_configured';
      row.smsStatus = row.a2pComplianceStatus === 'approved' ? 'testing' : 'blocked';
      row.lastError = row.a2pComplianceStatus === 'approved'
        ? null
        : 'A2P/messaging compliance approval is required before live SMS';
      row.leaseOwner = null;
      row.leaseExpiresAt = null;
      const saved = await this.resources.save(row);
      await this.audit?.recordSystemEvent({
        tenantId,
        eventType: 'provider_resource.twilio_reconciled',
        resourceType: 'tenant_messaging_resource',
        resourceId: saved.id,
        afterState: {
          provisioningStep: saved.provisioningStep,
          smsStatus: saved.smsStatus,
          a2pComplianceStatus: saved.a2pComplianceStatus,
        },
      });
      return saved;
    } catch (error: any) {
      row.smsStatus = 'failed';
      row.lastError = sanitizeOperationalText(error?.message || 'Twilio provisioning failed');
      row.leaseOwner = null;
      row.leaseExpiresAt = null;
      await this.resources.save(row);
      this.logger.error(`Twilio tenant provisioning failed for ${tenantId}: ${row.lastError}`);
      throw error;
    }
  }

  async markValidated(tenantId: string) {
    const row = await this.resources.findOne({ where: { tenantId } });
    if (!row) throw new BadRequestException('Twilio resources are not provisioned');
    if (row.a2pComplianceStatus !== 'approved') {
      throw new BadRequestException('Messaging compliance approval is required');
    }
    row.smsStatus = 'ready';
    row.smsLastVerifiedAt = new Date();
    row.lastError = null;
    row.provisioningStep = 'validated';
    const saved = await this.resources.save(row);
    await this.audit?.recordSystemEvent({
      tenantId,
      eventType: 'provider_resource.sms_validated',
      resourceType: 'tenant_messaging_resource',
      resourceId: saved.id,
      afterState: { smsStatus: saved.smsStatus, smsLastVerifiedAt: saved.smsLastVerifiedAt },
    });
    return saved;
  }

  async setComplianceStatus(
    tenantId: string,
    status: 'not_started' | 'pending' | 'approved' | 'blocked',
    identifiers?: {
      customerProfileSid?: string;
      brandSid?: string;
      campaignSid?: string;
    },
  ) {
    const row = await this.resources.findOne({ where: { tenantId } });
    if (!row) throw new BadRequestException('Twilio resources are not provisioned');
    const beforeState = {
      a2pComplianceStatus: row.a2pComplianceStatus,
      a2pCustomerProfileSid: row.a2pCustomerProfileSid,
      a2pBrandSid: row.a2pBrandSid,
      a2pCampaignSid: row.a2pCampaignSid,
    };
    row.a2pComplianceStatus = status;
    if (identifiers?.customerProfileSid) row.a2pCustomerProfileSid = identifiers.customerProfileSid;
    if (identifiers?.brandSid) row.a2pBrandSid = identifiers.brandSid;
    if (identifiers?.campaignSid) row.a2pCampaignSid = identifiers.campaignSid;
    if (status === 'approved' && row.provisioningStep === 'callbacks_configured') {
      row.smsStatus = 'testing';
      row.lastError = null;
    } else if (status === 'blocked') {
      row.smsStatus = 'blocked';
      row.lastError = 'Twilio messaging compliance is blocked';
    }
    const saved = await this.resources.save(row);
    await this.audit?.recordSystemEvent({
      tenantId,
      eventType: 'provider_resource.twilio_compliance_changed',
      resourceType: 'tenant_messaging_resource',
      resourceId: saved.id,
      beforeState,
      afterState: {
        a2pComplianceStatus: saved.a2pComplianceStatus,
        a2pCustomerProfileSid: saved.a2pCustomerProfileSid,
        a2pBrandSid: saved.a2pBrandSid,
        a2pCampaignSid: saved.a2pCampaignSid,
      },
    });
    return saved;
  }
}

function findNamedResource(items: unknown, friendlyName: string) {
  if (!Array.isArray(items)) return null;
  return items.find(
    (item: TwilioJson) => String(item.friendly_name || '') === friendlyName,
  ) || null;
}

async function twilioDelete(
  url: string,
  accountSid: string,
  authToken: string,
) {
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
    },
  });
  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(
      `Twilio delete failed (${response.status}): ${text.slice(0, 300)}`,
    );
  }
}

async function twilioRequest(
  url: string,
  accountSid: string,
  authToken: string,
  form?: Record<string, string | null>,
): Promise<TwilioJson> {
  const response = await fetch(url, {
    method: form ? 'POST' : 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(form
      ? { body: new URLSearchParams(Object.entries(form).filter(([, value]) => value !== null) as Array<[string, string]>).toString() }
      : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Twilio request failed (${response.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

function requiredUrl(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!/^https:\/\//i.test(value)) throw new BadRequestException(`${name} must be an HTTPS URL`);
  return value;
}
