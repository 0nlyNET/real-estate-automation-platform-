import { TwilioProvisioningService } from './twilio-provisioning.service';

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
    expect(calls.filter((url) => url.endsWith('/Accounts.json'))).toHaveLength(1);
  });
});

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}
