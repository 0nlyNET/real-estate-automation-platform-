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
        messageFlow: 'Consumer requests information on a listing form.',
        optInDescription: 'Consumer checks the SMS consent box.',
        optOutDescription: 'Reply STOP to opt out.',
        helpDescription: 'Reply HELP for help.',
        sampleMessage: 'Sunset Realty: Thanks for your inquiry. Reply STOP to opt out.',
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
});

function response(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  } as Response;
}
