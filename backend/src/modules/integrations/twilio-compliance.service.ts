import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
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
    const inputHash = complianceInputHash(input);
    if (resource.a2pInputHash && resource.a2pInputHash !== inputHash) {
      const reason = 'Twilio registration data changed and requires a reviewed resubmission';
      resource.a2pComplianceStatus = 'blocked';
      resource.a2pProviderStatus = 'correction_required';
      resource.a2pRejectionReason = reason;
      resource.a2pNextPollAt = null;
      resource.smsStatus = 'blocked';
      resource.lastError = reason;
      await this.resources.save(resource);
      await this.actionRequired(resource, tenant, reason);
      return { status: 'action_required' as const, reason };
    }
    const hasExistingGraph = Boolean(
      resource.a2pCustomerProfileSid || resource.a2pTrustProductSid ||
      resource.a2pBrandSid || resource.a2pCampaignSid,
    );
    if (!resource.a2pInputHash) {
      resource.a2pInputHash = inputHash;
      await this.resources.save(resource);
    }
    const accountSid = resource.twilioSubaccountSid;
    const authToken = decryptString(resource.encryptedAuthToken);
    const friendlyName = hasExistingGraph
      ? `RealtyTechAI tenant ${tenantId}`
      : `RealtyTechAI tenant ${tenantId} ${inputHash.slice(0, 8)}`;
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
        }
        resource.a2pCustomerProfileSid = String(profile.sid);
        await this.resources.save(resource);
        if (requiresProfilePopulation(profile.status)) {
          await this.populateCustomerProfile(profile.sid, friendlyName, input, auth);
        }
      }

      let profile = await request(
        `https://trusthub.twilio.com/v1/CustomerProfiles/${resource.a2pCustomerProfileSid}`,
        auth,
      );
      // A provider/network failure can happen after the profile SID is saved
      // but before its components are attached. Resume that exact graph on the
      // next reconciliation instead of leaving a draft profile stranded.
      if (requiresProfilePopulation(profile.status)) {
        await this.populateCustomerProfile(
          resource.a2pCustomerProfileSid,
          friendlyName,
          input,
          auth,
        );
        profile = await request(
          `https://trusthub.twilio.com/v1/CustomerProfiles/${resource.a2pCustomerProfileSid}`,
          auth,
        );
      }
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
        }
        resource.a2pTrustProductSid = String(product.sid);
        await this.resources.save(resource);
        if (requiresProfilePopulation(product.status)) {
          await this.populateTrustProduct(
            product.sid,
            resource.a2pCustomerProfileSid,
            friendlyName,
            input,
            auth,
          );
        }
      }

      let product = await request(
        `https://trusthub.twilio.com/v1/TrustProducts/${resource.a2pTrustProductSid}`,
        auth,
      );
      if (requiresProfilePopulation(product.status)) {
        await this.populateTrustProduct(
          resource.a2pTrustProductSid,
          resource.a2pCustomerProfileSid,
          friendlyName,
          input,
          auth,
        );
        product = await request(
          `https://trusthub.twilio.com/v1/TrustProducts/${resource.a2pTrustProductSid}`,
          auth,
        );
      }
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
            { 'X-Twilio-Api-Version': 'v1.2' },
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

  async resubmitAfterCorrection(tenantId: string) {
    const [resource, record, tenant] = await Promise.all([
      this.resources.findOne({ where: { tenantId } }),
      this.onboarding.findOne({ where: { tenantId } }),
      this.tenants.findOne({ where: { id: tenantId } }),
    ]);
    if (!resource || !record || !tenant) {
      throw new BadRequestException('Tenant provisioning records are incomplete');
    }
    if (resource.a2pProviderStatus !== 'rejected' && resource.a2pComplianceStatus !== 'blocked') {
      throw new BadRequestException('Only a rejected Twilio registration can be resubmitted');
    }
    const input = complianceInput(record);
    if (input.missing.length) {
      throw new BadRequestException(`Missing A2P information: ${input.missing.join(', ')}`);
    }
    const inputHash = complianceInputHash(input);
    if (resource.a2pInputHash && resource.a2pInputHash === inputHash) {
      throw new BadRequestException('Correct the rejected onboarding information before resubmitting');
    }

    resource.a2pCustomerProfileSid = null;
    resource.a2pTrustProductSid = null;
    resource.a2pBrandSid = null;
    resource.a2pCampaignSid = null;
    resource.a2pInputHash = inputHash;
    resource.a2pComplianceStatus = 'pending';
    resource.a2pProviderStatus = 'resubmitting';
    resource.a2pRejectionReason = null;
    resource.a2pLastCheckedAt = new Date();
    resource.a2pNextPollAt = new Date();
    resource.smsStatus = 'blocked';
    resource.lastError = null;
    await this.resources.save(resource);
    tenant.provisioningStatus = 'SMS_PROVISIONING';
    tenant.provisioningLastError = null;
    await this.tenants.save(tenant);
    await this.schedule(tenantId);
    return { status: 'resubmission_queued' as const, inputHash: inputHash.slice(0, 12) };
  }

  private async populateCustomerProfile(
    profileSid: string,
    friendlyName: string,
    input: ReturnType<typeof complianceInput>,
    auth: { accountSid: string; authToken: string },
  ) {
    const business = await findOrCreateNamedResource({
      collectionUrl: 'https://trusthub.twilio.com/v1/EndUsers',
      friendlyName: `${friendlyName} business`,
      auth,
      form: {
        FriendlyName: `${friendlyName} business`,
        Type: 'customer_profile_business_information',
        Attributes: JSON.stringify(input.businessAttributes),
      },
    });
    const representative = await findOrCreateNamedResource({
      collectionUrl: 'https://trusthub.twilio.com/v1/EndUsers',
      friendlyName: `${friendlyName} representative`,
      auth,
      form: {
        FriendlyName: `${friendlyName} representative`,
        Type: 'authorized_representative_1',
        Attributes: JSON.stringify(input.representativeAttributes),
      },
    });
    const address = await findOrCreateNamedResource({
      collectionUrl: `https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Addresses.json`,
      friendlyName: `${friendlyName} address`,
      auth,
      resultKeys: ['addresses'],
      form: {
        FriendlyName: `${friendlyName} address`,
        CustomerName: String(input.businessAttributes.business_name),
        Street: String(input.address.street),
        City: String(input.address.city),
        Region: String(input.address.region),
        PostalCode: String(input.address.postalCode),
        IsoCountry: String(input.address.country),
        AutoCorrect: 'true',
      },
    });
    const addressDocument = await findOrCreateNamedResource({
      collectionUrl: 'https://trusthub.twilio.com/v1/SupportingDocuments',
      friendlyName: `${friendlyName} address document`,
      auth,
      form: {
        FriendlyName: `${friendlyName} address document`,
        Type: 'customer_profile_address',
        Attributes: JSON.stringify({ address_sids: [String(address.sid)] }),
      },
    });
    for (const objectSid of [business.sid, representative.sid, addressDocument.sid]) {
      await ensureEntityAssignment(
        `https://trusthub.twilio.com/v1/CustomerProfiles/${profileSid}/EntityAssignments`,
        String(objectSid),
        auth,
      );
    }
    const primaryProfileSid = requiredSetting('TWILIO_PRIMARY_CUSTOMER_PROFILE_SID');
    await ensureEntityAssignment(
      `https://trusthub.twilio.com/v1/CustomerProfiles/${profileSid}/EntityAssignments`,
      primaryProfileSid,
      auth,
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

  private async populateTrustProduct(
    productSid: string,
    customerProfileSid: string,
    friendlyName: string,
    input: ReturnType<typeof complianceInput>,
    auth: { accountSid: string; authToken: string },
  ) {
    const messagingProfile = await findOrCreateNamedResource({
      collectionUrl: 'https://trusthub.twilio.com/v1/EndUsers',
      friendlyName: `${friendlyName} A2P messaging profile`,
      auth,
      form: {
        FriendlyName: `${friendlyName} A2P messaging profile`,
        Type: 'us_a2p_messaging_profile_information',
        Attributes: JSON.stringify(input.a2pMessagingProfileAttributes),
      },
    });
    const assignmentsUrl =
      `https://trusthub.twilio.com/v1/TrustProducts/${productSid}/EntityAssignments`;
    await ensureEntityAssignment(assignmentsUrl, customerProfileSid, auth);
    await ensureEntityAssignment(assignmentsUrl, String(messagingProfile.sid), auth);
    const policySid = requiredSetting('TWILIO_A2P_TRUST_PRODUCT_POLICY_SID');
    const evaluation = await request(
      `https://trusthub.twilio.com/v1/TrustProducts/${productSid}/Evaluations`,
      auth,
      { PolicySid: policySid },
    );
    if (String(evaluation.status || '').toLowerCase() === 'noncompliant') {
      throw new Error(`Twilio Trust Product evaluation failed: ${providerErrors(evaluation)}`);
    }
    await request(
      `https://trusthub.twilio.com/v1/TrustProducts/${productSid}`,
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
    campaignDescription: consent.campaignDescription,
    messageFlow: consent.messageFlow,
    sampleMessage: consent.sampleMessage,
    sampleMessage2: consent.sampleMessage2,
    termsUrl: consent.termsUrl,
    privacyUrl: consent.privacyUrl,
  };
  if (String(business.companyType || 'private').toLowerCase() === 'public') {
    required.stockExchange = business.stockExchange;
    required.stockTicker = business.stockTicker;
    required.brandContactEmail = business.brandContactEmail || required.email;
  }
  const missing = Object.entries(required)
    .filter(([, value]) => !String(value || '').trim())
    .map(([key]) => key);
  const bounded = (
    key: string,
    value: unknown,
    minimum: number,
    maximum: number,
  ) => {
    const length = String(value || '').trim().length;
    if (length && (length < minimum || length > maximum)) {
      missing.push(`${key} (${minimum}-${maximum} characters)`);
    }
  };
  bounded('campaignDescription', required.campaignDescription, 40, 4_096);
  bounded('messageFlow', required.messageFlow, 40, 2_048);
  bounded('sampleMessage', required.sampleMessage, 20, 1_024);
  bounded('sampleMessage2', required.sampleMessage2, 20, 1_024);
  bounded('optInMessage', consent.optInMessage, 20, 320);
  bounded('optOutMessage', consent.optOutMessage, 20, 320);
  bounded('helpMessage', consent.helpMessage, 20, 320);
  return {
    missing,
    email: String(required.email || ''),
    brandType: String(business.brandType || 'STANDARD').toUpperCase(),
    businessAttributes: {
      business_name: required.legalBusinessName,
      business_type: twilioBusinessType(required.businessType),
      business_registration_identifier: 'EIN',
      business_registration_number: required.ein,
      business_identity: 'direct_customer',
      business_industry: business.industry || 'REAL_ESTATE',
      business_regions_of_operation: business.regionsOfOperation || 'USA_AND_CANADA',
      website_url: required.website,
    },
    address: {
      street: required.businessAddress,
      city: required.city,
      region: required.region,
      postalCode: required.postalCode,
      country: business.country || 'US',
    },
    representativeAttributes: {
      first_name: required.firstName,
      last_name: required.lastName,
      email: required.email,
      phone_number: required.phone,
      job_position: twilioJobPosition(required.jobPosition),
      business_title: representative.businessTitle || required.jobPosition,
    },
    a2pMessagingProfileAttributes: {
      company_type: twilioCompanyType(business.companyType),
      ...(String(business.companyType || '').toLowerCase() === 'public'
        ? {
            stock_exchange: business.stockExchange,
            stock_ticker: business.stockTicker,
            brand_contact_email: business.brandContactEmail || required.email,
          }
        : {}),
    },
    campaign: {
      description: required.campaignDescription,
      messageFlow: required.messageFlow,
      optInMessage: consent.optInMessage || null,
      optOutMessage: consent.optOutMessage || null,
      helpMessage: consent.helpMessage || null,
      optInKeyword: consent.optInMessage ? consent.optInKeyword || 'START' : null,
      optOutKeyword: consent.optOutMessage ? consent.optOutKeyword || 'STOP' : null,
      helpKeyword: consent.helpMessage ? consent.helpKeyword || 'HELP' : null,
      samples: [required.sampleMessage, required.sampleMessage2],
      termsUrl: required.termsUrl,
      privacyUrl: required.privacyUrl,
      useCase: consent.a2pUseCase || 'LOW_VOLUME',
      hasEmbeddedLinks: Boolean(consent.hasEmbeddedLinks),
      hasEmbeddedPhone: Boolean(consent.hasEmbeddedPhone),
    },
  };
}

function complianceInputHash(input: ReturnType<typeof complianceInput>) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function campaignForm(brandSid: string, input: ReturnType<typeof complianceInput>) {
  return {
    BrandRegistrationSid: brandSid,
    Description: String(input.campaign.description),
    MessageFlow: String(input.campaign.messageFlow),
    'MessageSamples[0]': String(input.campaign.samples[0]),
    'MessageSamples[1]': String(input.campaign.samples[1]),
    UsAppToPersonUsecase: String(input.campaign.useCase),
    HasEmbeddedLinks: String(input.campaign.hasEmbeddedLinks),
    HasEmbeddedPhone: String(input.campaign.hasEmbeddedPhone),
    SubscriberOptIn: 'true',
    OptInMessage: optionalFormValue(input.campaign.optInMessage),
    OptOutMessage: optionalFormValue(input.campaign.optOutMessage),
    HelpMessage: optionalFormValue(input.campaign.helpMessage),
    'OptInKeywords[0]': optionalFormValue(input.campaign.optInKeyword),
    'OptOutKeywords[0]': optionalFormValue(input.campaign.optOutKeyword),
    'HelpKeywords[0]': optionalFormValue(input.campaign.helpKeyword),
    AgeGated: 'false',
    DirectLending: 'false',
    TermsAndConditionsUrl: String(input.campaign.termsUrl),
    PrivacyPolicyUrl: String(input.campaign.privacyUrl),
  };
}

function optionalFormValue(value: unknown) {
  const result = String(value || '').trim();
  return result || null;
}

function twilioBusinessType(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  const values: Record<string, string> = {
    llc: 'Limited Liability Corporation',
    'limited liability company': 'Limited Liability Corporation',
    'limited liability corporation': 'Limited Liability Corporation',
    corporation: 'Corporation',
    partnership: 'Partnership',
    'sole proprietorship': 'Sole Proprietorship',
    cooperative: 'Co-operative',
    'co-operative': 'Co-operative',
    nonprofit: 'Non-profit Corporation',
    'non-profit': 'Non-profit Corporation',
    'non-profit corporation': 'Non-profit Corporation',
  };
  return values[normalized] || String(value || '').trim();
}

function twilioJobPosition(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  const values: Record<string, string> = {
    director: 'Director',
    gm: 'GM',
    'general manager': 'GM',
    vp: 'VP',
    'vice president': 'VP',
    ceo: 'CEO',
    owner: 'CEO',
    founder: 'CEO',
    cfo: 'CFO',
    'general counsel': 'General Counsel',
  };
  return values[normalized] || 'Other';
}

function twilioCompanyType(value: unknown) {
  const normalized = String(value || 'private').trim().toLowerCase();
  if (['nonprofit', 'non_profit', 'non-profit'].includes(normalized)) {
    return 'non-profit';
  }
  if (['government', 'public', 'private'].includes(normalized)) return normalized;
  return 'private';
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

function requiresProfilePopulation(status: unknown) {
  const value = String(status || 'draft').toLowerCase().replace(/_/g, '-');
  return ['', 'draft', 'incomplete', 'unverified'].includes(value);
}

async function findOrCreateNamedResource(input: {
  collectionUrl: string;
  friendlyName: string;
  auth: { accountSid: string; authToken: string };
  form: Record<string, string | null>;
  resultKeys?: string[];
}) {
  const separator = input.collectionUrl.includes('?') ? '&' : '?';
  const listing = await request(
    `${input.collectionUrl}${separator}PageSize=1000`,
    input.auth,
  );
  const candidates = [
    listing.results,
    ...(input.resultKeys || []).map((key) => listing[key]),
  ].find(Array.isArray);
  return (
    named(candidates, input.friendlyName) ||
    request(input.collectionUrl, input.auth, input.form)
  );
}

async function ensureEntityAssignment(
  collectionUrl: string,
  objectSid: string,
  auth: { accountSid: string; authToken: string },
) {
  const existing = await request(`${collectionUrl}?PageSize=1000`, auth);
  const assignments = Array.isArray(existing.results) ? existing.results : [];
  if (
    assignments.some(
      (assignment: Json) =>
        String(assignment.object_sid || assignment.objectSid) === objectSid,
    )
  ) {
    return assignments.find(
      (assignment: Json) =>
        String(assignment.object_sid || assignment.objectSid) === objectSid,
    );
  }
  return request(collectionUrl, auth, { ObjectSid: objectSid });
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
  additionalHeaders?: Record<string, string>,
) {
  const response = await fetch(url, {
    method: form ? 'POST' : 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${auth.accountSid}:${auth.authToken}`).toString('base64')}`,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(additionalHeaders || {}),
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
