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
      {} as any,
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
