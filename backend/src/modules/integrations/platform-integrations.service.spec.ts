import { ProviderConfigService } from './provider-config.service';
import { EmailIdentityService } from './email-identity.service';
import { decryptIntegrationPayload } from './integrations.service';
import { PlatformIntegrationsService } from './platform-integrations.service';

describe('platform-managed tenant messaging assignments', () => {
  function harness() {
    const tenantCredentials = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
    };
    const messaging = {
      findOne: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        twilioSubaccountSid: 'AC-sub',
        phoneNumber: '+15550000001',
        a2pComplianceStatus: 'approved',
        smsStatus: 'testing',
        lastError: null,
        updatedAt: new Date('2026-08-11T00:00:00Z'),
      }),
    };
    const email = {
      findOne: jest.fn().mockResolvedValue({
        tenantId: 'tenant-1',
        fromEmail: 'lakeview@send.example.com',
        fromName: 'Lakeview Realty',
        inboundAddress: 'random-token@reply.example.com',
        reputationStatus: 'warming',
        emailStatus: 'testing',
        lastError: null,
        updatedAt: new Date('2026-08-11T00:00:00Z'),
      }),
    };
    const onboarding = {
      invalidateLaunchEvidence: jest.fn().mockResolvedValue({}),
    };
    const twilioProvisioning = {
      provisionTenant: jest.fn().mockResolvedValue({}),
    };
    const emailIdentity = {
      provisionTenant: jest.fn().mockResolvedValue({}),
    };
    const service = new PlatformIntegrationsService(
      { findOne: jest.fn().mockResolvedValue(null) } as any,
      tenantCredentials as any,
      onboarding as any,
      messaging as any,
      email as any,
      twilioProvisioning as any,
      emailIdentity as any,
    );
    return {
      service,
      tenantCredentials,
      onboarding,
      twilioProvisioning,
      emailIdentity,
    };
  }

  it('provisions managed resources without copying platform secrets into tenant credentials', async () => {
    const item = harness();
    await item.service.assignTwilio('tenant-1', { fromNumber: '' });
    await item.service.assignSendGrid('tenant-1', {
      fromEmail: '',
      fromName: 'Lakeview Realty',
    });

    expect(item.twilioProvisioning.provisionTenant).toHaveBeenCalledWith('tenant-1');
    expect(item.emailIdentity.provisionTenant).toHaveBeenCalledWith('tenant-1', {
      fromName: 'Lakeview Realty',
    });
    expect(item.tenantCredentials.save).not.toHaveBeenCalled();
  });

  it('persists failed status and recovers both identity and platform readiness through one real-send test', async () => {
    const originalFetch = global.fetch;
    const originalKey = process.env.INTEGRATIONS_ENCRYPTION_KEY;
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    const root = { provider: 'sendgrid', encryptedValue: JSON.stringify({
      apiKey: 'SG.test-only', configured: true, connected: false, error: null,
    }) };
    const platformRepo = { findOne: jest.fn(async () => root), save: jest.fn(async (row) => row) };
    const identity = {
      id: 'identity-1', tenantId: 'tenant-1', emailStatus: 'testing', reputationStatus: 'warming',
      fromEmail: 'broker@send.example.com', fromName: 'Broker', inboundAddress: 'unique@reply.example.com',
      lastError: null as string | null,
    };
    const emailRepo = {
      findOne: jest.fn(async () => identity), save: jest.fn(async (row) => row),
      update: jest.fn(async (_where, patch) => Object.assign(identity, patch)),
    };
    const messagingRepo = { findOne: jest.fn(async () => null) };
    const provider = new ProviderConfigService(platformRepo as any, messagingRepo as any, emailRepo as any);
    const identities = new EmailIdentityService(emailRepo as any, {} as any);
    const makeService = () => new PlatformIntegrationsService(
      platformRepo as any, {} as any, undefined, messagingRepo as any, emailRepo as any,
      undefined, identities, provider,
    );
    try {
      global.fetch = jest.fn(async () => new Response('Forbidden', { status: 403 })) as any;
      await expect(makeService().testTenantSendGrid('tenant-1', { toEmail: 'test@example.com' })).resolves.toMatchObject({ ok: false });
      expect(identity.emailStatus).toBe('failed');
      expect((await makeService().tenantSummary('tenant-1')).sendgrid.connected).toBe(false);
      expect(await provider.resolveSendGrid('tenant-1')).toBeNull();

      global.fetch = jest.fn(async () => new Response(null, { status: 202, headers: { 'x-message-id': 'provider-acceptance' } })) as any;
      await expect(makeService().testTenantSendGrid('tenant-1', { toEmail: 'test@example.com' })).resolves.toEqual({ ok: true });
      const sentBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(sentBody).toMatchObject({ from: { email: identity.fromEmail }, reply_to: { email: identity.inboundAddress } });
      expect(root.encryptedValue).toMatch(/^v1:/);
      expect(decryptIntegrationPayload(root.encryptedValue)).toMatchObject({ connected: true, error: null });
      expect((await makeService().tenantSummary('tenant-1')).sendgrid.connected).toBe(true);
      expect(await provider.resolveSendGrid('tenant-1')).toMatchObject({ fromEmail: identity.fromEmail });

      root.encryptedValue = JSON.stringify({ apiKey: 'SG.rotated', connected: false });
      expect((await makeService().tenantSummary('tenant-1')).sendgrid.connected).toBe(false);
      expect(await provider.resolveSendGrid('tenant-1')).toBeNull();
    } finally {
      global.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
      else process.env.INTEGRATIONS_ENCRYPTION_KEY = originalKey;
    }
  });

  it('returns client-safe status and routing identities without provider credentials or SIDs', async () => {
    const summary = await harness().service.tenantSummary('tenant-1');
    expect(summary).toMatchObject({
      twilio: {
        status: 'testing',
        display: { fromNumber: '+15550000001', complianceStatus: 'approved' },
      },
      sendgrid: {
        status: 'testing',
        display: {
          fromEmail: 'lakeview@send.example.com',
          inboundAddress: 'random-token@reply.example.com',
        },
      },
    });
    expect(JSON.stringify(summary)).not.toContain('AC-sub');
    expect(JSON.stringify(summary)).not.toMatch(/authToken|apiKey|encrypted/i);
  });
});
