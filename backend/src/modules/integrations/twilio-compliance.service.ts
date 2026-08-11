import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { decryptString } from '../../common/crypto-secrets';
import { sanitizeOperationalText } from '../../common/operational-log';
import { DurableJobsService } from '../durable-jobs/durable-jobs.service';
import { OnboardingRecord } from '../onboarding/onboarding-record.entity';
import { OperationsService } from '../operations/operations.service';
import { Tenant } from '../tenants/tenant.entity';
import { TenantMessagingResource } from './tenant-messaging-resource.entity';

type Json = Record<string, any>;

@Injectable()
export class TwilioComplianceService implements OnModuleInit {
  constructor(
    @InjectRepository(TenantMessagingResource)
    private readonly resources: Repository<TenantMessagingResource>,
    @InjectRepository(OnboardingRecord)
    private readonly onboarding: Repository<OnboardingRecord>,
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly operations: OperationsService,
    @Optional() private readonly jobs?: DurableJobsService,
  ) {}

  onModuleInit() {
    if (!this.jobs) return;
    this.jobs.register('twilio.a2p_reconcile', async (job) => {
      if (!job.tenantId) throw new Error('A2P job is missing tenantId');
      try {
        const result = await this.reconcile(job.tenantId);
        if (['pending', 'in_review'].includes(result.status)) {
          return { nextRunAt: new Date(Date.now() + 15 * 60_000) };
        }
      } catch (error: any) {
        if (job.attemptCount >= job.maxAttempts) {
          await this.operations.createTask({
            tenantId: job.tenantId,
            category: 'provider_configuration',
            title: 'Twilio compliance reconciliation retries were exhausted',
            description: sanitizeOperationalText(error?.message || error),
            priority: 'high',
            relatedEntityType: 'tenant',
            relatedEntityId: job.tenantId,
            dedupeOpen: true,
          });
        }
        throw error;
      }
    });
  }

  schedule(tenantId: string, nextRunAt = new Date()) {
    if (!this.jobs) return this.reconcile(tenantId);
    return this.jobs.schedule({
      taskType: 'twilio.a2p_reconcile',
      tenantId,
      dedupeKey: `twilio.a2p:${tenantId}`,
      nextRunAt,
      maxAttempts: 48,
    });
  }

  async reconcile(tenantId: string) {
    const [resource, record, tenant] = await Promise.all([
      this.resources.findOne({ where: { tenantId } }),
      this.onboarding.findOne({ where: { tenantId } }),
      this.tenants.findOne({ where: { id: tenantId } }),
    ]);
    if (!resource?.twilioSubaccountSid || !resource.encryptedAuthToken) {
      throw new BadRequestException('Twilio subaccount must be provisioned first');
    }
    if (!record || !tenant) throw new BadRequestException('Onboarding is incomplete');
    const input = complianceInput(record);
    if (input.missing.length) {
      await this.actionRequired(
        resource,
        tenant,
        `Missing A2P information: ${input.missing.join(', ')}`,
      );
      return { status: 'action_required' as const, missing: input.missing };
    }
    const accountSid = resource.twilioSubaccountSid;
    const authToken = decryptString(resource.encryptedAuthToken);
    const friendlyName = `RealtyTechAI tenant ${tenantId}`;
    const auth = { accountSid, authToken };
    try {
      if (!resource.a2pCustomerProfileSid) {
        const profiles = await request(
          'https://trusthub.twilio.com/v1/CustomerProfiles?PageSize=1000',
          auth,
        );
        let profile = named(profiles.results, friendlyName);
        if (!profile) {
          profile = await request(
            'https://trusthub.twilio.com/v1/CustomerProfiles',
            auth,
            {
              FriendlyName: friendlyName,
              Email: input.email,
              PolicySid: requiredSetting('TWILIO_SECONDARY_PROFILE_POLICY_SID'),
            },
          );
          await this.populateCustomerProfile(profile.sid, friendlyName, input, auth);
        }
        resource.a2pCustomerProfileSid = String(profile.sid);
        await this.resources.save(resource);
      }

      let profile = await request(
        `https://trusthub.twilio.com/v1/CustomerProfiles/${resource.a2pCustomerProfileSid}`,
        auth,
      );
      if (providerStatus(profile.status) === 'failed') {
        return this.reject(resource, tenant, providerErrors(profile));
      }
      if (providerStatus(profile.status) !== 'approved') {
        await this.markPending(resource, `customer_profile:${profile.status}`);
        return { status: 'pending' as const };
      }

      if (!resource.a2pTrustProductSid) {
        const products = await request(
          'https://trusthub.twilio.com/v1/TrustProducts?PageSize=1000',
          auth,
        );
        let product = named(products.results, friendlyName);
        if (!product) {
          const policySid = requiredSetting('TWILIO_A2P_TRUST_PRODUCT_POLICY_SID');
          product = await request(
            'https://trusthub.twilio.com/v1/TrustProducts',
            auth,
            { FriendlyName: friendlyName, Email: input.email, PolicySid: policySid },
          );
          await request(
            `https://trusthub.twilio.com/v1/TrustProducts/${product.sid}/EntityAssignments`,
            auth,
            { ObjectSid: resource.a2pCustomerProfileSid },
          );
          await request(
            `https://trusthub.twilio.com/v1/TrustProducts/${product.sid}/Evaluations`,
            auth,
            { PolicySid: policySid },
          );
          await request(
            `https://trusthub.twilio.com/v1/TrustProducts/${product.sid}`,
            auth,
            { Status: 'pending-review' },
          );
        }
        resource.a2pTrustProductSid = String(product.sid);
        await this.resources.save(resource);
      }

      const product = await request(
        `https://trusthub.twilio.com/v1/TrustProducts/${resource.a2pTrustProductSid}`,
        auth,
      );
      if (providerStatus(product.status) === 'failed') {
        return this.reject(resource, tenant, providerErrors(product));
      }
      if (providerStatus(product.status) !== 'approved') {
        await this.markPending(resource, `trust_product:${product.status}`);
        return { status: 'pending' as const };
      }

      if (!resource.a2pBrandSid) {
        const brands = await request(
          'https://messaging.twilio.com/v1/a2p/BrandRegistrations?PageSize=1000',
          auth,
        );
        const brand = (Array.isArray(brands.data)
          ? brands.data.find(
              (item: Json) =>
                item.customer_profile_bundle_sid === resource.a2pCustomerProfileSid &&
                item.a2p_profile_bundle_sid === resource.a2pTrustProductSid,
            )
          : null) ||
          (await request(
            'https://messaging.twilio.com/v1/a2p/BrandRegistrations',
            auth,
            {
              CustomerProfileBundleSid: resource.a2pCustomerProfileSid,
              A2PProfileBundleSid: resource.a2pTrustProductSid,
              BrandType: input.brandType,
            },
          ));
        resource.a2pBrandSid = String(brand.sid);
        await this.resources.save(resource);
      }
      const brand = await request(
        `https://messaging.twilio.com/v1/a2p/BrandRegistrations/${resource.a2pBrandSid}`,
        auth,
      );
      if (providerStatus(brand.status) === 'failed') {
        return this.reject(resource, tenant, providerErrors(brand));
      }
      if (providerStatus(brand.status) !== 'approved') {
        await this.markPending(resource, `brand:${brand.status}`);
        return { status: 'pending' as const };
      }

      if (!resource.a2pCampaignSid) {
        const campaigns = await request(
          `https://messaging.twilio.com/v1/Services/${resource.messagingServiceSid}/Compliance/Usa2p?PageSize=1000`,
          auth,
        );
        const campaign = (Array.isArray(campaigns.us_app_to_person)
          ? campaigns.us_app_to_person.find(
              (item: Json) => item.brand_registration_sid === resource.a2pBrandSid,
            )
          : null) ||
          (await request(
            `https://messaging.twilio.com/v1/Services/${resource.messagingServiceSid}/Compliance/Usa2p`,
            auth,
            campaignForm(resource.a2pBrandSid, input),
          ));
        resource.a2pCampaignSid = String(campaign.sid);
        await this.resources.save(resource);
      }
      const campaign = await request(
        `https://messaging.twilio.com/v1/Services/${resource.messagingServiceSid}/Compliance/Usa2p/${resource.a2pCampaignSid}`,
        auth,
      );
      if (providerStatus(campaign.campaign_status || campaign.status) === 'failed') {
        return this.reject(resource, tenant, providerErrors(campaign));
      }
      if (providerStatus(campaign.campaign_status || campaign.status) !== 'approved') {
        await this.markPending(
          resource,
          `campaign:${campaign.campaign_status || campaign.status}`,
        );
        return { status: 'pending' as const };
      }
      resource.a2pComplianceStatus = 'approved';
      resource.a2pProviderStatus = 'approved';
      resource.a2pRejectionReason = null;
      resource.a2pLastCheckedAt = new Date();
      resource.a2pNextPollAt = null;
      resource.smsStatus = 'testing';
      resource.lastError = null;
      await this.resources.save(resource);
      tenant.provisioningStatus = 'TESTING';
      tenant.provisioningLastError = null;
      await this.tenants.save(tenant);
      await this.operations.resolveRecoverableTasks({
        tenantId,
        category: 'provider_configuration',
        relatedEntityType: 'tenant',
        relatedEntityId: tenantId,
        evidenceNote: 'Twilio approved the customer profile, brand, and campaign.',
      });
      await this.jobs?.schedule({
        taskType: 'testing.start',
        tenantId,
        dedupeKey: `testing.start:${tenantId}`,
        payload: controlledRecipients(record),
      });
      return { status: 'approved' as const };
    } catch (error: any) {
      const reason = sanitizeOperationalText(error?.message || error, 2_000);
      resource.a2pLastCheckedAt = new Date();
      resource.a2pNextPollAt = new Date(Date.now() + 15 * 60_000);
      resource.lastError = reason;
      await this.resources.save(resource);
      throw error;
    }
  }

  private async populateCustomerProfile(
    profileSid: string,
    friendlyName: string,
    input: ReturnType<typeof complianceInput>,
    auth: { accountSid: string; authToken: string },
  ) {
    const business = await request('https://trusthub.twilio.com/v1/EndUsers', auth, {
      FriendlyName: `${friendlyName} business`,
      Type: 'customer_profile_business_information',
      Attributes: JSON.stringify(input.businessAttributes),
    });
    const representative = await request(
      'https://trusthub.twilio.com/v1/EndUsers',
      auth,
      {
        FriendlyName: `${friendlyName} representative`,
        Type: 'authorized_representative_1',
        Attributes: JSON.stringify(input.representativeAttributes),
      },
    );
    for (const objectSid of [business.sid, representative.sid]) {
      await request(
        `https://trusthub.twilio.com/v1/CustomerProfiles/${profileSid}/EntityAssignments`,
        auth,
        { ObjectSid: String(objectSid) },
      );
    }
    const primaryProfileSid = requiredSetting('TWILIO_PRIMARY_CUSTOMER_PROFILE_SID');
    await request(
      `https://trusthub.twilio.com/v1/CustomerProfiles/${profileSid}/EntityAssignments`,
      auth,
      { ObjectSid: primaryProfileSid },
    );
    const policySid = requiredSetting('TWILIO_SECONDARY_PROFILE_POLICY_SID');
    const evaluation = await request(
      `https://trusthub.twilio.com/v1/CustomerProfiles/${profileSid}/Evaluations`,
      auth,
      { PolicySid: policySid },
    );
    if (String(evaluation.status || '').toLowerCase() === 'noncompliant') {
      throw new Error(`Twilio profile evaluation failed: ${providerErrors(evaluation)}`);
    }
    await request(
      `https://trusthub.twilio.com/v1/CustomerProfiles/${profileSid}`,
      auth,
      { Status: 'pending-review' },
    );
  }

  private async markPending(resource: TenantMessagingResource, status: string) {
    resource.a2pComplianceStatus = 'pending';
    resource.a2pProviderStatus = status;
    resource.a2pLastCheckedAt = new Date();
    resource.a2pNextPollAt = new Date(Date.now() + 15 * 60_000);
    resource.smsStatus = 'blocked';
    resource.lastError = 'Twilio compliance review is pending';
    await this.resources.save(resource);
  }

  private async reject(
    resource: TenantMessagingResource,
    tenant: Tenant,
    reason: string,
  ) {
    const safe = sanitizeOperationalText(reason || 'Twilio rejected the registration', 2_000);
    resource.a2pComplianceStatus = 'blocked';
    resource.a2pProviderStatus = 'rejected';
    resource.a2pRejectionReason = safe;
    resource.a2pLastCheckedAt = new Date();
    resource.a2pNextPollAt = null;
    resource.smsStatus = 'blocked';
    resource.lastError = safe;
    await this.resources.save(resource);
    await this.actionRequired(resource, tenant, safe);
    return { status: 'action_required' as const, reason: safe };
  }

  private async actionRequired(
    resource: TenantMessagingResource,
    tenant: Tenant,
    reason: string,
  ) {
    tenant.provisioningStatus = 'ACTION_REQUIRED';
    tenant.provisioningLastError = reason;
    await this.tenants.save(tenant);
    await this.operations.createTask({
      tenantId: tenant.id,
      category: 'provider_configuration',
      title: 'Twilio registration information needs correction',
      description: reason,
      priority: 'high',
      relatedEntityType: 'tenant_messaging_resource',
      relatedEntityId: resource.id,
      dedupeOpen: true,
    });
  }
}

function controlledRecipients(record: OnboardingRecord) {
  const contacts = record.contacts || {};
  return {
    smsRecipient: contacts.controlledTestPhone || null,
    emailRecipient:
      contacts.controlledTestEmail || contacts.accountOwner || null,
  };
}

function complianceInput(record: OnboardingRecord) {
  const business = record.businessIdentity || {};
  const contacts = record.contacts || {};
  const consent = record.consentConfiguration || {};
  const representative = (contacts.authorizedRepresentative || contacts) as Json;
  const required: Record<string, unknown> = {
    legalBusinessName: business.legalBusinessName,
    businessType: business.businessType,
    ein: business.ein,
    website: business.website,
    businessAddress: business.businessAddress,
    city: business.city,
    region: business.region,
    postalCode: business.postalCode,
    firstName: representative.firstName,
    lastName: representative.lastName,
    email: representative.email || contacts.accountOwner,
    phone: representative.phone,
    jobPosition: representative.jobPosition,
    messageFlow: consent.messageFlow,
    optInDescription: consent.optInDescription,
    optOutDescription: consent.optOutDescription,
    helpDescription: consent.helpDescription,
    sampleMessage: consent.sampleMessage,
    termsUrl: consent.termsUrl,
    privacyUrl: consent.privacyUrl,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !String(value || '').trim())
    .map(([key]) => key);
  return {
    missing,
    email: String(required.email || ''),
    brandType: String(business.brandType || 'STANDARD').toUpperCase(),
    businessAttributes: {
      business_name: required.legalBusinessName,
      business_type: required.businessType,
      business_registration_identifier: 'EIN',
      business_registration_number: required.ein,
      business_identity: 'direct_customer',
      business_industry: business.industry || 'REAL_ESTATE',
      business_regions_of_operation: business.regionsOfOperation || 'USA_AND_CANADA',
      business_website: required.website,
      business_address: required.businessAddress,
      business_city: required.city,
      business_state_province_region: required.region,
      business_postal_code: required.postalCode,
      business_country: business.country || 'US',
    },
    representativeAttributes: {
      first_name: required.firstName,
      last_name: required.lastName,
      email: required.email,
      phone_number: required.phone,
      job_position: required.jobPosition,
      business_title: representative.businessTitle || required.jobPosition,
    },
    campaign: {
      description: consent.campaignDescription || 'Real estate lead follow-up requested by the consumer',
      messageFlow: required.messageFlow,
      optIn: required.optInDescription,
      optOut: required.optOutDescription,
      help: required.helpDescription,
      sample: required.sampleMessage,
      termsUrl: required.termsUrl,
      privacyUrl: required.privacyUrl,
      useCase: consent.a2pUseCase || 'LOW_VOLUME',
    },
  };
}

function campaignForm(brandSid: string, input: ReturnType<typeof complianceInput>) {
  return {
    BrandRegistrationSid: brandSid,
    Description: String(input.campaign.description),
    MessageFlow: String(input.campaign.messageFlow),
    'MessageSamples[0]': String(input.campaign.sample),
    UsAppToPersonUsecase: String(input.campaign.useCase),
    HasEmbeddedLinks: 'false',
    HasEmbeddedPhone: 'false',
    SubscriberOptIn: String(input.campaign.optIn),
    SubscriberOptOut: String(input.campaign.optOut),
    SubscriberHelp: String(input.campaign.help),
    AgeGatedContent: 'false',
    DirectLending: 'false',
    TermsAndConditions: String(input.campaign.termsUrl),
    PrivacyPolicy: String(input.campaign.privacyUrl),
  };
}

function requiredSetting(name: string) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required for automated Twilio compliance`);
  return value;
}

function named(items: unknown, friendlyName: string) {
  if (!Array.isArray(items)) return null;
  return items.find((item: Json) => item.friendly_name === friendlyName) || null;
}

function providerStatus(value: unknown) {
  const status = String(value || '').toLowerCase().replace(/_/g, '-');
  if (['twilio-approved', 'approved', 'in-use', 'verified'].includes(status)) return 'approved';
  if (['failed', 'rejected', 'twilio-rejected', 'noncompliant', 'suspended'].includes(status)) return 'failed';
  return 'pending';
}

function providerErrors(payload: Json) {
  return sanitizeOperationalText(
    payload.failure_reason ||
      payload.status_callback ||
      JSON.stringify(payload.errors || payload.results || payload),
    2_000,
  );
}

async function request(
  url: string,
  auth: { accountSid: string; authToken: string },
  form?: Record<string, string | null>,
) {
  const response = await fetch(url, {
    method: form ? 'POST' : 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${auth.accountSid}:${auth.authToken}`).toString('base64')}`,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(form
      ? {
          body: new URLSearchParams(
            Object.entries(form).filter(([, value]) => value !== null) as Array<[string, string]>,
          ).toString(),
        }
      : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Twilio compliance request failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as Json) : {};
}
