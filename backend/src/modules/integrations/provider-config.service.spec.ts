import { encryptString } from '../../common/crypto-secrets';
import { ProviderConfigService } from './provider-config.service';

describe('ProviderConfigService tenant isolation', () => {
  const originalKey = process.env.INTEGRATIONS_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
    else process.env.INTEGRATIONS_ENCRYPTION_KEY = originalKey;
  });

  it('resolves only the requested tenant resources while sharing the platform SendGrid key', async () => {
    const platform = {
      findOne: jest.fn(async ({ where }) => ({
        provider: where.provider,
        encryptedValue: JSON.stringify(
          where.provider === 'sendgrid'
            ? { apiKey: 'SG.platform-only' }
            : { accountSid: 'AC-parent', authToken: 'parent-secret' },
        ),
      })),
    };
    const twilioRows: Record<string, any> = {
      'tenant-a': {
        tenantId: 'tenant-a', smsStatus: 'ready', twilioParentAccountSid: 'AC-parent', twilioSubaccountSid: 'AC-a',
        encryptedAuthToken: encryptString('token-a'), phoneNumber: '+15550000001', messagingServiceSid: 'MG-a',
      },
      'tenant-b': {
        tenantId: 'tenant-b', smsStatus: 'ready', twilioParentAccountSid: 'AC-parent', twilioSubaccountSid: 'AC-b',
        encryptedAuthToken: encryptString('token-b'), phoneNumber: '+15550000002', messagingServiceSid: 'MG-b',
      },
    };
    const emailRows: Record<string, any> = {
      'tenant-a': {
        tenantId: 'tenant-a', emailStatus: 'ready', reputationStatus: 'healthy',
        fromEmail: 'a@send.example.com', fromName: 'A Realty', inboundAddress: 'token-a@reply.example.com',
        classification: 'lead_follow_up',
      },
      'tenant-b': {
        tenantId: 'tenant-b', emailStatus: 'ready', reputationStatus: 'healthy',
        fromEmail: 'b@send.example.com', fromName: 'B Realty', inboundAddress: 'token-b@reply.example.com',
        classification: 'lead_follow_up',
      },
    };
    const service = new ProviderConfigService(
      platform as any,
      { findOne: jest.fn(async ({ where }) => twilioRows[where.tenantId] || null) } as any,
      { findOne: jest.fn(async ({ where }) => emailRows[where.tenantId] || null) } as any,
    );

    await expect(service.resolveTwilio('tenant-a')).resolves.toMatchObject({
      accountSid: 'AC-a', authToken: 'token-a', fromNumber: '+15550000001',
    });
    await expect(service.resolveSendGrid('tenant-b')).resolves.toMatchObject({
      apiKey: 'SG.platform-only', fromEmail: 'b@send.example.com', inboundAddress: 'token-b@reply.example.com',
    });
    expect(await service.resolveTwilio('tenant-a')).not.toMatchObject({ accountSid: 'AC-b' });
  });
});
