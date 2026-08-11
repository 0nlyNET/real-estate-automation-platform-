import { TwilioProvisioningService } from './twilio-provisioning.service';
import { encryptString } from '../../common/crypto-secrets';

describe('TwilioProvisioningService resumability', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64');
    process.env.TWILIO_WEBHOOK_URL = 'https://api.example.com/webhooks/twilio/inbound';
    process.env.TWILIO_STATUS_CALLBACK_URL = 'https://api.example.com/webhooks/twilio/status';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it('persists the subaccount immediately and does not create it twice after a retry', async () => {
    let row: any = null;
    const resources = {
      findOne: jest.fn(async () => row),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        row = value;
        return value;
      }),
    };
    const service = new TwilioProvisioningService(
      {} as any,
      resources as any,
      { findOne: jest.fn().mockResolvedValue({ encryptedValue: JSON.stringify({ accountSid: 'AC-parent', authToken: 'parent-token' }) }) } as any,
      { findOne: jest.fn().mockResolvedValue({ id: 'tenant-a', name: 'A Realty' }) } as any,
    );
    const calls: string[] = [];
    let failKeyOnce = true;
    global.fetch = jest.fn(async (url: any) => {
      const value = String(url);
      calls.push(value);
      if (value.endsWith('/Accounts.json')) {
        return response(201, { sid: 'AC-sub', auth_token: 'sub-token' });
      }
      if (value.endsWith('/Keys.json') && failKeyOnce) {
        failKeyOnce = false;
        return response(500, { message: 'temporary failure' });
      }
      if (value.endsWith('/Keys.json')) return response(201, { sid: 'SK-sub', secret: 'key-secret' });
      if (value.endsWith('/Services')) return response(201, { sid: 'MG-sub' });
      if (value.includes('/AvailablePhoneNumbers/')) {
        return response(200, { available_phone_numbers: [{ phone_number: '+15550000001' }] });
      }
      if (value.endsWith('/IncomingPhoneNumbers.json')) {
        return response(201, { sid: 'PN-sub', phone_number: '+15550000001' });
      }
      return response(200, {});
    }) as any;

    await expect(service.provisionTenant('tenant-a')).rejects.toThrow('Twilio request failed');
    expect(row.twilioSubaccountSid).toBe('AC-sub');
    expect(row.encryptedAuthToken).toMatch(/^v1:/);

    await expect(service.provisionTenant('tenant-a')).resolves.toMatchObject({
      twilioSubaccountSid: 'AC-sub',
      messagingServiceSid: 'MG-sub',
      phoneNumber: '+15550000001',
      smsStatus: 'blocked',
    });
    await expect(service.provisionTenant('tenant-a')).resolves.toMatchObject({
      twilioSubaccountSid: 'AC-sub',
      messagingServiceSid: 'MG-sub',
      phoneNumberSid: 'PN-sub',
    });
    expect(calls.filter((url) => url.endsWith('/Accounts.json'))).toHaveLength(1);
    expect(calls.filter((url) => url.endsWith('/Services'))).toHaveLength(1);
    expect(calls.filter((url) => url.endsWith('/IncomingPhoneNumbers.json'))).toHaveLength(1);
  });

  it('recovers a subaccount created before an ambiguous connection failure', async () => {
    const harness = resourceHarness(null);
    const service = makeService(harness);
    let remoteAccount: any = null;
    let accountCreates = 0;
    let crash = true;
    global.fetch = jest.fn(async (url: any, init: any = {}) => {
      const value = String(url);
      if (value.includes('/Accounts.json?')) {
        return response(200, { accounts: remoteAccount ? [remoteAccount] : [] });
      }
      if (value.endsWith('/Accounts.json') && init.method === 'POST') {
        accountCreates += 1;
        remoteAccount = {
          sid: 'AC-sub',
          auth_token: 'sub-token',
          friendly_name: 'RealtyTechAI tenant tenant-a',
        };
        if (crash) {
          crash = false;
          throw new Error('connection reset after provider accepted request');
        }
        return response(201, remoteAccount);
      }
      return completedProvisioningResponse(value, init);
    }) as any;

    await expect(service.provisionTenant('tenant-a')).rejects.toThrow('connection reset');
    await expect(service.provisionTenant('tenant-a')).resolves.toMatchObject({
      twilioSubaccountSid: 'AC-sub',
      provisioningStep: 'callbacks_configured',
    });
    expect(accountCreates).toBe(1);
  });

  it('recovers a purchased number after an ambiguous connection failure', async () => {
    const harness = resourceHarness(provisionedRow({
      phoneNumberSid: null,
      phoneNumber: null,
      provisioningStep: 'messaging_service_created',
    }));
    const service = makeService(harness);
    let remoteNumber: any = null;
    let purchases = 0;
    let crash = true;
    global.fetch = jest.fn(async (url: any, init: any = {}) => {
      const value = String(url);
      if (value.includes('/IncomingPhoneNumbers.json?')) {
        return response(200, {
          incoming_phone_numbers: remoteNumber ? [remoteNumber] : [],
        });
      }
      if (value.endsWith('/IncomingPhoneNumbers.json') && init.method === 'POST') {
        purchases += 1;
        remoteNumber = {
          sid: 'PN-sub',
          phone_number: '+15550000001',
          friendly_name: 'RealtyTechAI tenant tenant-a',
        };
        if (crash) {
          crash = false;
          throw new Error('connection reset after number purchase');
        }
        return response(201, remoteNumber);
      }
      return completedProvisioningResponse(value, init);
    }) as any;

    await expect(service.provisionTenant('tenant-a')).rejects.toThrow('connection reset');
    await expect(service.provisionTenant('tenant-a')).resolves.toMatchObject({
      phoneNumberSid: 'PN-sub',
      phoneNumber: '+15550000001',
    });
    expect(purchases).toBe(1);
  });

  it('recovers sender attachment after an ambiguous connection failure', async () => {
    const harness = resourceHarness(provisionedRow({
      phoneNumberSid: 'PN-sub',
      phoneNumber: '+15550000001',
      provisioningStep: 'number_purchased',
    }));
    const service = makeService(harness);
    let attached = false;
    let attachments = 0;
    let crash = true;
    global.fetch = jest.fn(async (url: any, init: any = {}) => {
      const value = String(url);
      if (value.includes('/Services/MG-sub/PhoneNumbers?')) {
        return response(200, {
          phone_numbers: attached ? [{ phone_number_sid: 'PN-sub' }] : [],
        });
      }
      if (value.endsWith('/Services/MG-sub/PhoneNumbers') && init.method === 'POST') {
        attachments += 1;
        attached = true;
        if (crash) {
          crash = false;
          throw new Error('connection reset after sender attachment');
        }
        return response(201, { sid: 'PN-sub' });
      }
      return completedProvisioningResponse(value, init);
    }) as any;

    await expect(service.provisionTenant('tenant-a')).rejects.toThrow('connection reset');
    await expect(service.provisionTenant('tenant-a')).resolves.toMatchObject({
      provisioningStep: 'callbacks_configured',
    });
    expect(attachments).toBe(1);
  });
});

function resourceHarness(initial: any) {
  let row = initial;
  return {
    get row() {
      return row;
    },
    repository: {
      findOne: jest.fn(async () => row),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => {
        row = value;
        return value;
      }),
    },
  };
}

function makeService(harness: ReturnType<typeof resourceHarness>) {
  return new TwilioProvisioningService(
    {} as any,
    harness.repository as any,
    {
      findOne: jest.fn().mockResolvedValue({
        encryptedValue: JSON.stringify({
          accountSid: 'AC-parent',
          authToken: 'parent-token',
        }),
      }),
    } as any,
    {
      findOne: jest.fn().mockResolvedValue({
        id: 'tenant-a',
        name: 'A Realty',
      }),
    } as any,
  );
}

function provisionedRow(overrides: Record<string, unknown>) {
  return {
    id: 'resource-1',
    tenantId: 'tenant-a',
    twilioParentAccountSid: 'AC-parent',
    twilioSubaccountSid: 'AC-sub',
    twilioApiKeySid: 'SK-sub',
    encryptedApiSecret: encryptString('key-secret'),
    encryptedAuthToken: encryptString('sub-token'),
    messagingServiceSid: 'MG-sub',
    phoneNumberSid: null,
    phoneNumber: null,
    a2pComplianceStatus: 'pending',
    smsStatus: 'failed',
    lastError: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    ...overrides,
  };
}

function completedProvisioningResponse(url: string, init: any) {
  if (url.endsWith('/Keys.json?PageSize=1000')) return response(200, { keys: [] });
  if (url.endsWith('/Keys.json') && init.method === 'POST') {
    return response(201, { sid: 'SK-sub', secret: 'key-secret' });
  }
  if (url.endsWith('/Services?PageSize=1000')) {
    return response(200, {
      services: [{ sid: 'MG-sub', friendly_name: 'RealtyTechAI tenant tenant-a' }],
    });
  }
  if (url.includes('/AvailablePhoneNumbers/')) {
    return response(200, {
      available_phone_numbers: [{ phone_number: '+15550000001' }],
    });
  }
  if (url.endsWith('/IncomingPhoneNumbers.json') && init.method === 'POST') {
    return response(201, { sid: 'PN-sub', phone_number: '+15550000001' });
  }
  if (url.includes('/IncomingPhoneNumbers.json?')) {
    return response(200, { incoming_phone_numbers: [] });
  }
  if (url.includes('/Services/MG-sub/PhoneNumbers?')) {
    return response(200, { phone_numbers: [{ phone_number_sid: 'PN-sub' }] });
  }
  if (url.endsWith('/Services/MG-sub/PhoneNumbers') && init.method === 'POST') {
    return response(201, { sid: 'PN-sub' });
  }
  return response(200, {});
}

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}
