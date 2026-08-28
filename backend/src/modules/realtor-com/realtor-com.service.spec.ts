import { UnauthorizedException } from '@nestjs/common';
import { RealtorComService } from './realtor-com.service';
import { encryptString } from '../../common/crypto-secrets';

describe('RealtorComService', () => {
  const original = { ...process.env };
  let credentials: any;
  let leads: any;
  let service: RealtorComService;

  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.PUBLIC_API_URL = 'https://api.example.com';
    credentials = {
      findOne: jest.fn(),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
      remove: jest.fn(),
    };
    leads = { intake: jest.fn(async () => ({ id: 'lead-1' })) };
    service = new RealtorComService(credentials, leads);
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('requires a public API URL before generating provider credentials', async () => {
    delete process.env.PUBLIC_API_URL;
    await expect(service.rotateKey('tenant-1')).rejects.toThrow('PUBLIC_API_URL');
  });

  it('authenticates a provider test and exposes only the API key suffix afterward', async () => {
    credentials.findOne.mockResolvedValue(null);
    const setup = await service.rotateKey('tenant-1');
    expect(setup.endpointPath).toBe('/webhooks/realtor-com/tenant-1');
    expect(setup.endpointUrl).toBe(
      'https://api.example.com/webhooks/realtor-com/tenant-1',
    );
    const row = credentials.save.mock.calls[0][0];
    credentials.findOne.mockResolvedValue(row);

    await expect(
      service.receiveLead('tenant-1', { 'x-api-key': setup.apiKey }, { test: true }),
    ).resolves.toEqual({ success: true, status: 'connected' });

    const visible = await service.getSetup('tenant-1');
    expect(visible.connected).toBe(true);
    expect(visible.apiKeyLast4).toBe(setup.apiKeyLast4);
    expect(JSON.stringify(visible)).not.toContain(setup.apiKey);
  });

  it('rejects an invalid key without creating a lead', async () => {
    const apiKey = 'correct-key';
    const row = {
      encryptedValue: encryptString(JSON.stringify({
        configured: true,
        connected: false,
        apiKey,
        loginName: 'realtytechai-tenant-1',
        createdAt: new Date().toISOString(),
        lastSync: null,
        error: null,
      })),
    };
    credentials.findOne.mockResolvedValue(row);

    await expect(
      service.receiveLead('tenant-1', { 'x-api-key': 'wrong-key' }, { name: 'Jordan' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(leads.intake).not.toHaveBeenCalled();
  });

  it('passes normalized provider leads through the existing intake service', async () => {
    const row = {
      encryptedValue: encryptString(JSON.stringify({
        configured: true,
        connected: false,
        apiKey: 'provider-key',
        loginName: 'realtytechai-tenant-1',
        createdAt: new Date().toISOString(),
        lastSync: null,
        error: null,
      })),
    };
    credentials.findOne.mockResolvedValue(row);

    await expect(
      service.receiveLead(
        'tenant-1',
        { 'x-api-key': 'provider-key' },
        { firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com' },
      ),
    ).resolves.toMatchObject({ success: true, status: 'accepted', leadId: 'lead-1' });
    expect(leads.intake).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ fullName: 'Jordan Lee', source: 'Realtor.com' }),
    );
  });
});
