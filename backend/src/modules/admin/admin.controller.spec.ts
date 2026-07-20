import { ForbiddenException } from '@nestjs/common';
import { AdminController } from './admin.controller';

describe('AdminController role-sensitive onboarding evidence', () => {
  function setup() {
    const onboarding = {
      recordOperatorEvidence: jest.fn().mockResolvedValue({ ok: true }),
    };
    const controller = new AdminController(
      {} as any,
      {} as any,
      {} as any,
      onboarding as any,
    );
    return { controller, onboarding };
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
});
