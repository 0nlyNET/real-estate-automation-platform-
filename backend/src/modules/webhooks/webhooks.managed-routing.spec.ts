import { encryptString } from '../../common/crypto-secrets';
import { WebhooksService } from './webhooks.service';

describe('managed provider webhook routing isolation', () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  afterEach(() => {
    process.env = { ...original };
  });

  function service() {
    const messagingRows: Record<string, any> = {
      '+15550000001': {
        tenantId: 'tenant-a',
        phoneNumber: '+15550000001',
        messagingServiceSid: 'MG-a',
        encryptedAuthToken: encryptString('token-a'),
        smsStatus: 'ready',
      },
      '+15550000002': {
        tenantId: 'tenant-b',
        phoneNumber: '+15550000002',
        messagingServiceSid: 'MG-b',
        encryptedAuthToken: encryptString('token-b'),
        smsStatus: 'ready',
      },
    };
    const emailRows: Record<string, any> = {
      'tnt_random_a@reply.example.com': {
        tenantId: 'tenant-a',
        inboundAddress: 'tnt_random_a@reply.example.com',
        emailStatus: 'ready',
        lastError: null,
      },
      'tnt_random_b@reply.example.com': {
        tenantId: 'tenant-b',
        inboundAddress: 'tnt_random_b@reply.example.com',
        emailStatus: 'ready',
        lastError: null,
      },
    };
    const credentials = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };
    const messagingResources = {
      findOne: jest.fn(async ({ where }: any) =>
        where.phoneNumber
          ? messagingRows[where.phoneNumber] || null
          : Object.values(messagingRows).find(
              (row: any) => row.tenantId === where.tenantId || row.messagingServiceSid === where.messagingServiceSid,
            ) || null,
      ),
    };
    const emailIdentities = {
      findOne: jest.fn(async ({ where }: any) => emailRows[where.inboundAddress] || null),
    };
    return new WebhooksService(
      {} as any,
      credentials as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      messagingResources as any,
      emailIdentities as any,
    );
  }

  it('routes two dedicated Twilio numbers to only their owning tenant', async () => {
    const webhooks = service() as any;
    await expect(webhooks.findTwilioRoute('+15550000001')).resolves.toMatchObject({
      tenantId: 'tenant-a',
      authToken: 'token-a',
    });
    await expect(webhooks.findTwilioRoute('+15550000002')).resolves.toMatchObject({
      tenantId: 'tenant-b',
      authToken: 'token-b',
    });
    await expect(webhooks.findTwilioRoute('+15559999999')).resolves.toBeNull();
  });

  it('routes only the complete random SendGrid reply address and rejects unknown tokens', async () => {
    const webhooks = service() as any;
    await expect(webhooks.findSendGridRoute('tnt_random_a@reply.example.com')).resolves.toMatchObject({
      tenantId: 'tenant-a',
    });
    await expect(webhooks.findSendGridRoute('tnt_random_b@reply.example.com')).resolves.toMatchObject({
      tenantId: 'tenant-b',
    });
    await expect(webhooks.findSendGridRoute('tnt_random_a@other.example.com')).resolves.toBeNull();
    await expect(webhooks.findSendGridRoute('tenant-a@reply.example.com')).resolves.toBeNull();
  });
});
