import { encryptString } from '../../common/crypto-secrets';
import { TwilioComplianceService } from './twilio-compliance.service';

describe('TwilioComplianceService provider reconciliation', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 6).toString('base64');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it('promotes messaging to TESTING only after every provider resource is approved', async () => {
    const resource: any = {
      id: 'resource-1',
      tenantId: 'tenant-1',
      twilioSubaccountSid: 'AC-sub',
      encryptedAuthToken: encryptString('sub-token'),
      messagingServiceSid: 'MG-sub',
      a2pCustomerProfileSid: 'BU-customer',
      a2pTrustProductSid: 'BU-product',
      a2pBrandSid: 'BN-brand',
      a2pCampaignSid: 'QE-campaign',
      a2pComplianceStatus: 'pending',
      smsStatus: 'blocked',
    };
    const tenant: any = {
      id: 'tenant-1',
      provisioningStatus: 'COMPLIANCE_PENDING',
    };
    const onboarding = {
      businessIdentity: {
        legalBusinessName: 'Sunset Realty LLC',
        businessType: 'LLC',
        companyType: 'private',
        ein: '12-3456789',
        website: 'https://sunset.example.com',
        businessAddress: '1 Main Street',
        city: 'Austin',
        region: 'TX',
        postalCode: '78701',
      },
      contacts: {
        authorizedRepresentative: {
          firstName: 'Taylor',
          lastName: 'Owner',
          email: 'owner@sunset.example.com',
          phone: '+15125550100',
          jobPosition: 'Owner',
        },
      },
      consentConfiguration: {
        campaignDescription: 'Sunset Realty follows up with people who requested information about a real-estate listing.',
        messageFlow: 'Consumers request listing information at https://sunset.example.com and check the SMS consent box.',
        sampleMessage: 'Sunset Realty: Thanks for your inquiry. Reply STOP to opt out.',
        sampleMessage2: 'Sunset Realty: Are you still interested in the home? Reply STOP to opt out.',
        termsUrl: 'https://sunset.example.com/terms',
        privacyUrl: 'https://sunset.example.com/privacy',
      },
    };
    const resources = {
      findOne: jest.fn().mockResolvedValue(resource),
      save: jest.fn(async (value) => value),
    };
    const tenants = {
      findOne: jest.fn().mockResolvedValue(tenant),
      save: jest.fn(async (value) => value),
    };
    const operations = {
      resolveRecoverableTasks: jest.fn().mockResolvedValue(1),
      createTask: jest.fn(),
    };
    const jobs = {
      schedule: jest.fn().mockResolvedValue({ id: 'testing-job' }),
      register: jest.fn(),
    };
    global.fetch = jest.fn(async (url: any) => {
      const value = String(url);
      if (value.includes('/CustomerProfiles/')) return response({ status: 'twilio-approved' });
      if (value.includes('/TrustProducts/')) return response({ status: 'twilio-approved' });
      if (value.includes('/BrandRegistrations/')) return response({ status: 'APPROVED' });
      if (value.includes('/Compliance/Usa2p/')) {
        return response({ campaign_status: 'VERIFIED' });
      }
      throw new Error(`Unexpected Twilio request: ${value}`);
    }) as any;
    const service = new TwilioComplianceService(
      resources as any,
      { findOne: jest.fn().mockResolvedValue(onboarding) } as any,
      tenants as any,
      operations as any,
      jobs as any,
    );

    await expect(service.reconcile('tenant-1')).resolves.toEqual({
      status: 'approved',
    });
    expect(resource).toMatchObject({
      a2pComplianceStatus: 'approved',
      a2pProviderStatus: 'approved',
      smsStatus: 'testing',
      lastError: null,
    });
    expect(tenant).toMatchObject({
      provisioningStatus: 'TESTING',
      provisioningLastError: null,
    });
    expect(operations.resolveRecoverableTasks).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1' }),
    );
    expect(jobs.schedule).toHaveBeenCalledWith({
      taskType: 'testing.start',
      tenantId: 'tenant-1',
      dedupeKey: 'testing.start:tenant-1',
      payload: {
        smsRecipient: null,
        emailRecipient: null,
      },
    });
  });

  it('uses the current Twilio ISV request graph and exact provider field names', async () => {
    process.env.TWILIO_PRIMARY_CUSTOMER_PROFILE_SID = 'BU-primary';
    process.env.TWILIO_SECONDARY_PROFILE_POLICY_SID = 'RN-secondary';
    process.env.TWILIO_A2P_TRUST_PRODUCT_POLICY_SID = 'RN-a2p';
    const resource: any = {
      id: 'resource-1', tenantId: 'tenant-1', twilioSubaccountSid: 'AC-sub',
      encryptedAuthToken: encryptString('sub-token'), messagingServiceSid: 'MG-sub',
      a2pCustomerProfileSid: null, a2pTrustProductSid: null,
      a2pBrandSid: null, a2pCampaignSid: null, a2pComplianceStatus: 'not_started',
      smsStatus: 'blocked',
    };
    const tenant: any = { id: 'tenant-1', provisioningStatus: 'PROVISIONING' };
    const onboarding: any = {
      businessIdentity: {
        legalBusinessName: 'Sunset Realty LLC', businessType: 'LLC',
        companyType: 'private', ein: '12-3456789',
        website: 'https://sunset.example.com', businessAddress: '1 Main Street',
        city: 'Austin', region: 'TX', postalCode: '78701', country: 'US',
      },
      contacts: {
        accountOwner: 'owner@sunset.example.com',
        authorizedRepresentative: {
          firstName: 'Taylor', lastName: 'Owner', email: 'owner@sunset.example.com',
          phone: '+15125550100', jobPosition: 'Owner', businessTitle: 'Broker Owner',
        },
      },
      consentConfiguration: {
        campaignDescription: 'Sunset Realty follows up with consumers who request information about real-estate listings.',
        messageFlow: 'Consumers visit https://sunset.example.com/listings and check the SMS consent box before submitting a listing inquiry.',
        sampleMessage: 'Sunset Realty: Thanks for your listing inquiry. Reply STOP to opt out.',
        sampleMessage2: 'Sunset Realty: Would you like to schedule a tour? Reply STOP to opt out.',
        optInMessage: 'Sunset Realty: You are subscribed. Reply HELP for help or STOP to opt out.',
        optOutMessage: 'Sunset Realty: You are unsubscribed and will receive no more messages.',
        helpMessage: 'Sunset Realty: Call 5125550100 for help or reply STOP to opt out.',
        optInKeyword: 'START', optOutKeyword: 'STOP', helpKeyword: 'HELP',
        termsUrl: 'https://sunset.example.com/terms',
        privacyUrl: 'https://sunset.example.com/privacy',
        a2pUseCase: 'LOW_VOLUME', hasEmbeddedLinks: true, hasEmbeddedPhone: true,
      },
    };
    const captured: Array<{ url: string; method: string; form: Record<string, string>; headers: Record<string, string> }> = [];
    global.fetch = jest.fn(async (url: any, init: any = {}) => {
      const value = String(url);
      const method = String(init.method || 'GET');
      const form = Object.fromEntries(new URLSearchParams(String(init.body || '')).entries());
      captured.push({ url: value, method, form, headers: init.headers || {} });
      if (method === 'GET') {
        if (value.endsWith('/CustomerProfiles?PageSize=1000')) return response({ results: [] });
        if (value.endsWith('/CustomerProfiles/BU-customer')) return response({ sid: 'BU-customer', status: 'twilio-approved' });
        if (value.endsWith('/TrustProducts?PageSize=1000')) return response({ results: [] });
        if (value.endsWith('/TrustProducts/BU-product')) return response({ sid: 'BU-product', status: 'twilio-approved' });
        if (value.includes('/EndUsers?PageSize=1000')) return response({ results: [] });
        if (value.includes('/Addresses.json?PageSize=1000')) return response({ addresses: [] });
        if (value.includes('/SupportingDocuments?PageSize=1000')) return response({ results: [] });
        if (value.includes('/EntityAssignments?PageSize=1000')) return response({ results: [] });
        if (value.endsWith('/BrandRegistrations?PageSize=1000')) return response({ data: [] });
        if (value.endsWith('/BrandRegistrations/BN-brand')) return response({ sid: 'BN-brand', status: 'APPROVED' });
        if (value.endsWith('/Compliance/Usa2p?PageSize=1000')) return response({ us_app_to_person: [] });
        if (value.endsWith('/Compliance/Usa2p/QE-campaign')) return response({ sid: 'QE-campaign', campaign_status: 'VERIFIED' });
      }
      if (value.endsWith('/CustomerProfiles')) return response({ sid: 'BU-customer', status: 'draft' });
      if (value.endsWith('/TrustProducts')) return response({ sid: 'BU-product', status: 'draft' });
      if (value.endsWith('/EndUsers')) {
        const sid = form.Type === 'authorized_representative_1'
          ? 'IT-representative'
          : form.Type === 'us_a2p_messaging_profile_information'
            ? 'IT-a2p'
            : 'IT-business';
        return response({ sid });
      }
      if (value.endsWith('/Addresses.json')) return response({ sid: 'AD-address' });
      if (value.endsWith('/SupportingDocuments')) return response({ sid: 'RD-address' });
      if (value.includes('/EntityAssignments')) return response({ sid: 'BV-assignment' });
      if (value.includes('/Evaluations')) return response({ status: 'compliant' });
      if (value.endsWith('/CustomerProfiles/BU-customer')) return response({ status: 'pending-review' });
      if (value.endsWith('/TrustProducts/BU-product')) return response({ status: 'pending-review' });
      if (value.endsWith('/BrandRegistrations')) return response({ sid: 'BN-brand' });
      if (value.endsWith('/Compliance/Usa2p')) return response({ sid: 'QE-campaign' });
      throw new Error(`Unexpected Twilio request: ${method} ${value}`);
    }) as any;
    const service = new TwilioComplianceService(
      { findOne: jest.fn().mockResolvedValue(resource), save: jest.fn(async (value) => value) } as any,
      { findOne: jest.fn().mockResolvedValue(onboarding) } as any,
      { findOne: jest.fn().mockResolvedValue(tenant), save: jest.fn(async (value) => value) } as any,
      { resolveRecoverableTasks: jest.fn(), createTask: jest.fn() } as any,
      { schedule: jest.fn(), register: jest.fn() } as any,
    );

    await expect(service.reconcile('tenant-1')).resolves.toEqual({ status: 'approved' });
    const posted = (suffix: string, type?: string) => captured.find((item) =>
      item.method === 'POST' && item.url.endsWith(suffix) && (!type || item.form.Type === type));
    expect(JSON.parse(posted('/EndUsers', 'customer_profile_business_information')!.form.Attributes)).toEqual({
      business_name: 'Sunset Realty LLC',
      business_type: 'Limited Liability Corporation',
      business_registration_identifier: 'EIN',
      business_registration_number: '12-3456789',
      business_identity: 'direct_customer',
      business_industry: 'REAL_ESTATE',
      business_regions_of_operation: 'USA_AND_CANADA',
      website_url: 'https://sunset.example.com',
    });
    expect(JSON.parse(posted('/EndUsers', 'authorized_representative_1')!.form.Attributes)).toEqual({
      first_name: 'Taylor', last_name: 'Owner', email: 'owner@sunset.example.com',
      phone_number: '+15125550100', job_position: 'CEO', business_title: 'Broker Owner',
    });
    expect(posted('/Addresses.json')!.form).toMatchObject({
      CustomerName: 'Sunset Realty LLC', Street: '1 Main Street', City: 'Austin',
      Region: 'TX', PostalCode: '78701', IsoCountry: 'US', AutoCorrect: 'true',
    });
    expect(JSON.parse(posted('/SupportingDocuments')!.form.Attributes)).toEqual({ address_sids: ['AD-address'] });
    expect(JSON.parse(posted('/EndUsers', 'us_a2p_messaging_profile_information')!.form.Attributes)).toEqual({ company_type: 'private' });
    expect(posted('/BrandRegistrations')!.form).toEqual({
      CustomerProfileBundleSid: 'BU-customer', A2PProfileBundleSid: 'BU-product', BrandType: 'STANDARD',
    });
    const campaign = posted('/Compliance/Usa2p')!;
    expect(campaign.headers['X-Twilio-Api-Version']).toBe('v1.2');
    expect(campaign.form).toEqual({
      BrandRegistrationSid: 'BN-brand',
      Description: onboarding.consentConfiguration.campaignDescription,
      MessageFlow: onboarding.consentConfiguration.messageFlow,
      'MessageSamples[0]': onboarding.consentConfiguration.sampleMessage,
      'MessageSamples[1]': onboarding.consentConfiguration.sampleMessage2,
      UsAppToPersonUsecase: 'LOW_VOLUME', HasEmbeddedLinks: 'true', HasEmbeddedPhone: 'true',
      SubscriberOptIn: 'true', OptInMessage: onboarding.consentConfiguration.optInMessage,
      OptOutMessage: onboarding.consentConfiguration.optOutMessage,
      HelpMessage: onboarding.consentConfiguration.helpMessage,
      'OptInKeywords[0]': 'START', 'OptOutKeywords[0]': 'STOP', 'HelpKeywords[0]': 'HELP',
      AgeGated: 'false', DirectLending: 'false',
      TermsAndConditionsUrl: 'https://sunset.example.com/terms',
      PrivacyPolicyUrl: 'https://sunset.example.com/privacy',
    });
  });

  it('resubmits a rejected registration only after the client corrects its data', async () => {
    const resource: any = {
      id: 'resource-1', tenantId: 'tenant-1', twilioSubaccountSid: 'AC-sub',
      encryptedAuthToken: encryptString('sub-token'), messagingServiceSid: 'MG-sub',
      a2pCustomerProfileSid: 'BU-rejected', a2pTrustProductSid: 'BU-product',
      a2pBrandSid: 'BN-brand', a2pCampaignSid: 'QE-campaign',
      a2pComplianceStatus: 'blocked', a2pProviderStatus: 'rejected',
      a2pInputHash: 'previous-input', a2pRejectionReason: 'Legal name mismatch',
      smsStatus: 'blocked', lastError: 'Legal name mismatch',
    };
    const tenant: any = { id: 'tenant-1', provisioningStatus: 'ACTION_REQUIRED' };
    const onboarding: any = {
      businessIdentity: {
        legalBusinessName: 'Corrected Realty LLC', businessType: 'LLC',
        companyType: 'private', ein: '12-3456789', website: 'https://corrected.example.com',
        businessAddress: '1 Main Street', city: 'Austin', region: 'TX', postalCode: '78701',
      },
      contacts: { authorizedRepresentative: {
        firstName: 'Taylor', lastName: 'Owner', email: 'owner@corrected.example.com',
        phone: '+15125550100', jobPosition: 'Owner',
      } },
      consentConfiguration: {
        campaignDescription: 'Corrected Realty follows up with consumers who requested property information.',
        messageFlow: 'Consumers submit a property inquiry and explicitly check the SMS consent box before submission.',
        sampleMessage: 'Corrected Realty: Thanks for your inquiry. Reply STOP to opt out.',
        sampleMessage2: 'Corrected Realty: Would you like a tour? Reply STOP to opt out.',
        termsUrl: 'https://corrected.example.com/terms',
        privacyUrl: 'https://corrected.example.com/privacy',
      },
    };
    const resources = { findOne: jest.fn().mockResolvedValue(resource), save: jest.fn(async (value) => value) };
    const tenants = { findOne: jest.fn().mockResolvedValue(tenant), save: jest.fn(async (value) => value) };
    const jobs = { schedule: jest.fn().mockResolvedValue({ id: 'a2p-job' }), register: jest.fn() };
    const service = new TwilioComplianceService(
      resources as any,
      { findOne: jest.fn().mockResolvedValue(onboarding) } as any,
      tenants as any,
      { resolveRecoverableTasks: jest.fn(), createTask: jest.fn() } as any,
      jobs as any,
    );

    await expect(service.resubmitAfterCorrection('tenant-1')).resolves.toMatchObject({
      status: 'resubmission_queued',
    });
    expect(resource).toMatchObject({
      a2pCustomerProfileSid: null, a2pTrustProductSid: null,
      a2pBrandSid: null, a2pCampaignSid: null,
      a2pComplianceStatus: 'pending', a2pProviderStatus: 'resubmitting',
      a2pRejectionReason: null, smsStatus: 'blocked', lastError: null,
    });
    expect(resource.a2pInputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tenant).toMatchObject({ provisioningStatus: 'SMS_PROVISIONING', provisioningLastError: null });
    expect(jobs.schedule).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'twilio.a2p_reconcile', tenantId: 'tenant-1', dedupeKey: 'twilio.a2p:tenant-1',
    }));

    resource.a2pComplianceStatus = 'blocked';
    resource.a2pProviderStatus = 'rejected';
    await expect(service.resubmitAfterCorrection('tenant-1')).rejects.toThrow(
      'Correct the rejected onboarding information before resubmitting',
    );
  });

  it('blocks an approved graph when its registered onboarding data changes', async () => {
    const resource: any = {
      id: 'resource-1', tenantId: 'tenant-1', twilioSubaccountSid: 'AC-sub',
      encryptedAuthToken: encryptString('sub-token'), messagingServiceSid: 'MG-sub',
      a2pCustomerProfileSid: 'BU-approved', a2pTrustProductSid: 'BU-product',
      a2pBrandSid: 'BN-brand', a2pCampaignSid: 'QE-campaign',
      a2pComplianceStatus: 'approved', a2pProviderStatus: 'approved',
      a2pInputHash: 'hash-for-prior-data', smsStatus: 'ready',
    };
    const tenant: any = { id: 'tenant-1', provisioningStatus: 'ACTIVE' };
    const onboarding: any = {
      businessIdentity: {
        legalBusinessName: 'New Legal Name LLC', businessType: 'LLC', companyType: 'private',
        ein: '12-3456789', website: 'https://new-name.example.com', businessAddress: '1 Main Street',
        city: 'Austin', region: 'TX', postalCode: '78701',
      },
      contacts: { authorizedRepresentative: {
        firstName: 'Taylor', lastName: 'Owner', email: 'owner@new-name.example.com',
        phone: '+15125550100', jobPosition: 'Owner',
      } },
      consentConfiguration: {
        campaignDescription: 'New Legal Name Realty follows up with consumers who request listing information.',
        messageFlow: 'Consumers explicitly consent on the property inquiry form before submitting their contact details.',
        sampleMessage: 'New Legal Name Realty: Thanks for your inquiry. Reply STOP to opt out.',
        sampleMessage2: 'New Legal Name Realty: Would you like a tour? Reply STOP to opt out.',
        termsUrl: 'https://new-name.example.com/terms', privacyUrl: 'https://new-name.example.com/privacy',
      },
    };
    const operations = { createTask: jest.fn(), resolveRecoverableTasks: jest.fn() };
    global.fetch = jest.fn() as any;
    const service = new TwilioComplianceService(
      { findOne: jest.fn().mockResolvedValue(resource), save: jest.fn(async (value) => value) } as any,
      { findOne: jest.fn().mockResolvedValue(onboarding) } as any,
      { findOne: jest.fn().mockResolvedValue(tenant), save: jest.fn(async (value) => value) } as any,
      operations as any,
      { schedule: jest.fn(), register: jest.fn() } as any,
    );
    await expect(service.reconcile('tenant-1')).resolves.toMatchObject({
      status: 'action_required',
      reason: 'Twilio registration data changed and requires a reviewed resubmission',
    });
    expect(resource).toMatchObject({
      a2pComplianceStatus: 'blocked', a2pProviderStatus: 'correction_required', smsStatus: 'blocked',
    });
    expect(tenant.provisioningStatus).toBe('ACTION_REQUIRED');
    expect(operations.createTask).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

function response(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}
