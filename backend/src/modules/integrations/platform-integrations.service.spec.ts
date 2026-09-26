import { BadRequestException } from '@nestjs/common';
import { ProviderConfigService } from './provider-config.service';
import { EmailIdentityService } from './email-identity.service';
import { decryptIntegrationPayload } from './integration-crypto';
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

describe('platform credential-save encryption guard', () => {
  const VALID_KEY = Buffer.alloc(32, 7).toString('base64');

  function makeService() {
    const platformCredentials = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((values: Record<string, unknown>) => values),
      save: jest.fn(async (row: unknown) => row),
    };
    const tenantCredentials = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((values: Record<string, unknown>) => values),
      save: jest.fn(async (row: unknown) => row),
    };
    const service = new PlatformIntegrationsService(
      platformCredentials as any,
      tenantCredentials as any,
    );
    return { service, platformCredentials, tenantCredentials };
  }

  async function withKey(value: string | undefined, run: () => Promise<void>) {
    const original = process.env.INTEGRATIONS_ENCRYPTION_KEY;
    try {
      if (value === undefined) delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
      else process.env.INTEGRATIONS_ENCRYPTION_KEY = value;
      await run();
    } finally {
      if (original === undefined) delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
      else process.env.INTEGRATIONS_ENCRYPTION_KEY = original;
    }
  }

  it('rejects platform SendGrid saves with a 4xx naming INTEGRATIONS_ENCRYPTION_KEY when the key is missing', async () => {
    await withKey(undefined, async () => {
      const { service, platformCredentials } = makeService();
      await expect(service.savePlatformSendGrid({ apiKey: 'SG.test-key' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.savePlatformSendGrid({ apiKey: 'SG.test-key' })).rejects.toThrow(
        /INTEGRATIONS_ENCRYPTION_KEY/,
      );
      expect(platformCredentials.save).not.toHaveBeenCalled();
      expect(platformCredentials.create).not.toHaveBeenCalled();
    });
  });

  it('rejects platform Twilio saves with a 4xx naming INTEGRATIONS_ENCRYPTION_KEY when the key is invalid', async () => {
    await withKey('invalid', async () => {
      const { service, platformCredentials } = makeService();
      await expect(
        service.savePlatformTwilio({ accountSid: 'AC1234567890', authToken: 'token' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.savePlatformTwilio({ accountSid: 'AC1234567890', authToken: 'token' }),
      ).rejects.toThrow(/INTEGRATIONS_ENCRYPTION_KEY/);
      expect(platformCredentials.save).not.toHaveBeenCalled();
      expect(platformCredentials.create).not.toHaveBeenCalled();
    });
  });

  it('rejects tenant credential saves with a 4xx before any DB write when the key is missing', async () => {
    await withKey(undefined, async () => {
      const { service, tenantCredentials } = makeService();
      await expect(
        (service as any).saveTenantPayload('tenant-1', 'sendgrid', { configured: true }, null),
      ).rejects.toThrow(/INTEGRATIONS_ENCRYPTION_KEY/);
      expect(tenantCredentials.save).not.toHaveBeenCalled();
      expect(tenantCredentials.create).not.toHaveBeenCalled();
    });
  });

  it('reports encryptionReady=false with an issue string in the platform summary when the key is invalid', async () => {
    await withKey('invalid', async () => {
      const summary = await makeService().service.platformSummary();
      expect(summary.encryptionReady).toBe(false);
      expect(summary.encryptionIssue).toMatch(/INTEGRATIONS_ENCRYPTION_KEY/);
    });
  });

  it('reports encryptionReady=true and saves normally when the key is valid', async () => {
    await withKey(VALID_KEY, async () => {
      const { service, platformCredentials } = makeService();
      const summary = await service.platformSummary();
      expect(summary.encryptionReady).toBe(true);
      expect(summary.encryptionIssue).toBeNull();
      await service.savePlatformSendGrid({ apiKey: 'SG.test-key' });
      expect(platformCredentials.save).toHaveBeenCalled();
      const saved = platformCredentials.save.mock.calls[0][0] as { encryptedValue: string };
      expect(saved.encryptedValue).toMatch(/^v1:/);
      expect(decryptIntegrationPayload(saved.encryptedValue)).toMatchObject({
        apiKey: 'SG.test-key',
        configured: true,
      });
    });
  });
});
