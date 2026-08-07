import { BadRequestException } from '@nestjs/common';
import { Credential } from '../settings/credential.entity';
import { PlatformIntegrationsService } from './platform-integrations.service';

describe('platform-managed tenant messaging assignments', () => {
  const originalEncryptionKey = process.env.INTEGRATIONS_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
      'base64',
    );
  });

  afterAll(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.INTEGRATIONS_ENCRYPTION_KEY;
    } else {
      process.env.INTEGRATIONS_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  function harness(existing?: Credential | null) {
    let tenantRow = existing || null;
    const platformCredentials = {
      findOne: jest.fn().mockResolvedValue({
        provider: 'sendgrid',
        encryptedValue: JSON.stringify({
          configured: true,
          connected: true,
          apiKey: 'SG.platform-test-key',
          lastSync: '2026-08-07T00:00:00.000Z',
          error: null,
        }),
      }),
    };
    const tenantCredentials = {
      findOne: jest.fn(async () => tenantRow),
      find: jest.fn(async () => (tenantRow ? [tenantRow] : [])),
      create: jest.fn((value) => Object.assign(new Credential(), value)),
      save: jest.fn(async (value) => {
        tenantRow = value;
        return value;
      }),
    };
    const onboarding = {
      invalidateLaunchEvidence: jest.fn().mockResolvedValue({}),
    };
    return {
      service: new PlatformIntegrationsService(
        platformCredentials as any,
        tenantCredentials as any,
        onboarding as any,
      ),
      tenantCredentials,
      onboarding,
    };
  }

  it('requires complete sender and inbound routing fields, then invalidates stale launch evidence', async () => {
    const item = harness();
    await expect(
      item.service.assignSendGrid('tenant-1', {
        fromEmail: 'agent@lakeview.example',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(item.tenantCredentials.save).not.toHaveBeenCalled();

    await expect(
      item.service.assignSendGrid('tenant-1', {
        fromEmail: 'Agent@Lakeview.example',
        fromName: 'Lakeview Realty',
        inboundAddress: 'Replies@reply.lakeview.example',
      }),
    ).resolves.toMatchObject({
      sendgrid: {
        configured: true,
        connected: false,
        display: {
          fromEmail: 'agent@lakeview.example',
          fromName: 'Lakeview Realty',
          inboundAddress: 'replies@reply.lakeview.example',
        },
      },
    });
    expect(item.tenantCredentials.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'sendgrid',
        routingKey: 'replies@reply.lakeview.example',
      }),
    );
    expect(item.onboarding.invalidateLaunchEvidence).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        retestMessaging: true,
        sendgridApproval: true,
      }),
    );
  });

  it('treats an identical assignment as a no-op so valid evidence is not discarded', async () => {
    const existing = Object.assign(new Credential(), {
      provider: 'sendgrid',
      routingKey: 'replies@reply.lakeview.example',
      encryptedValue: JSON.stringify({
        configured: true,
        connected: true,
        managedByPlatform: true,
        apiKey: 'SG.platform-test-key',
        fromEmail: 'agent@lakeview.example',
        fromName: 'Lakeview Realty',
        inboundAddress: 'replies@reply.lakeview.example',
        lastSync: '2026-08-07T00:00:00.000Z',
        error: null,
      }),
      tenant: { id: 'tenant-1' },
    });
    const item = harness(existing);
    await item.service.assignSendGrid('tenant-1', {
      fromEmail: 'agent@lakeview.example',
      fromName: 'Lakeview Realty',
      inboundAddress: 'replies@reply.lakeview.example',
    });
    expect(item.tenantCredentials.save).not.toHaveBeenCalled();
    expect(item.onboarding.invalidateLaunchEvidence).not.toHaveBeenCalled();
  });
});
