import { ForbiddenException } from '@nestjs/common';
import { AdminController } from './admin.controller';

describe('AdminController role-sensitive onboarding evidence', () => {
  function setup() {
    const admin = {
      listTenants: jest.fn().mockResolvedValue([]),
    };
    const onboarding = {
      recordOperatorEvidence: jest.fn().mockResolvedValue({ ok: true }),
    };
    const serviceControl = {
      suspend: jest.fn().mockResolvedValue({ changed: true }),
      restore: jest.fn().mockResolvedValue({ changed: true }),
    };
    const platformIntegrations = {
      assignTwilio: jest.fn().mockResolvedValue({ twilio: { configured: true } }),
    };
    const controller = new AdminController(
      admin as any,
      {} as any,
      {} as any,
      onboarding as any,
      serviceControl as any,
      platformIntegrations as any,
    );
    return {
      controller,
      admin,
      onboarding,
      serviceControl,
      platformIntegrations,
    };
  }

  it('rejects a staff attempt to verify billing even through a direct API call', () => {
    const { controller, onboarding } = setup();
    expect(() => controller.onboardingEvidence(
      'tenant-1',
      { billingVerifiedAt: new Date().toISOString() } as any,
      { user: { sub: 'staff-1', platformRole: 'staff' } },
    )).toThrow(ForbiddenException);
    expect(onboarding.recordOperatorEvidence).not.toHaveBeenCalled();
  });

  it('passes the authenticated platform owner into service suspension history', async () => {
    const { controller, serviceControl } = setup();
    await expect(
      controller.suspendServices(
        '11111111-1111-4111-8111-111111111111',
        { reason: 'Payment not received.' },
        {
          user: {
            sub: '22222222-2222-4222-8222-222222222222',
            email: 'owner@example.com',
          },
        },
      ),
    ).resolves.toEqual({ changed: true });
    expect(serviceControl.suspend).toHaveBeenCalledWith({
      tenantId: '11111111-1111-4111-8111-111111111111',
      source: 'manual',
      reason: 'Payment not received.',
      actor: {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'owner@example.com',
      },
    });
  });

  it('allows a SuperAdmin to record billing verification', async () => {
    const { controller, onboarding } = setup();
    const body = { billingVerifiedAt: new Date().toISOString() } as any;
    await expect(controller.onboardingEvidence(
      'tenant-1',
      body,
      { user: { sub: 'owner-1', platformRole: 'super_admin' } },
    )).resolves.toEqual({ ok: true });
    expect(onboarding.recordOperatorEvidence).toHaveBeenCalledWith(
      'tenant-1',
      body,
      'owner-1',
    );
  });

  it('keeps billing reasons private from platform staff while showing service status', async () => {
    const { controller, admin } = setup();
    admin.listTenants.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Example Realty',
        status: 'past_due',
        lifecycleStatus: 'SUSPENDED',
        serviceSuspensionReason: 'Card payment failed.',
        serviceSuspensionSource: 'billing',
      },
    ]);

    await expect(
      controller.listTenants({ user: { platformRole: 'staff' } }),
    ).resolves.toEqual([
      expect.objectContaining({
        name: 'Example Realty',
        lifecycleStatus: 'SUSPENDED',
        serviceState: expect.objectContaining({
          state: 'suspended',
          reason: 'Services are stopped. Contact the platform owner for details.',
        }),
      }),
    ]);
    const [tenant] = await controller.listTenants({
      user: { platformRole: 'staff' },
    });
    expect(tenant).not.toHaveProperty('status');
    expect(tenant).not.toHaveProperty('serviceSuspensionReason');
    expect(tenant.serviceState.reason).not.toContain('Card');
  });

  it('delegates client Twilio assignments to platform-managed operations', async () => {
    const { controller, platformIntegrations } = setup();
    await expect(
      controller.assignTenantTwilio('tenant-1', { fromNumber: '+19296395472' }),
    ).resolves.toEqual({ twilio: { configured: true } });
    expect(platformIntegrations.assignTwilio).toHaveBeenCalledWith('tenant-1', {
      fromNumber: '+19296395472',
    });
  });
});
