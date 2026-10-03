import { EntitlementService } from './entitlement.service';

describe('operator email authorization retains other entitlements', () => {
  const original = process.env.GLOBAL_AUTOMATIONS_DISABLED;
  const tenant = { status: 'incomplete', lifecycleStatus: 'ACTIVE' };
  const grant = { id: 'grant-1' };
  const guard = { validateGrant: jest.fn().mockResolvedValue(grant) };
  const service = new EntitlementService({ findOne: async () => tenant } as any,
    { findOne: async () => ({ automationsEnabled: true }) } as any, guard as any);
  const options = { operatorTest: { grantId: 'grant-1', recipientEmail: 'owned@example.test', channel: 'email' as const } };
  afterEach(() => {
    tenant.lifecycleStatus = 'ACTIVE'; guard.validateGrant.mockResolvedValue(grant);
    if (original === undefined) delete process.env.GLOBAL_AUTOMATIONS_DISABLED;
    else process.env.GLOBAL_AUTOMATIONS_DISABLED = original;
  });
  it('authorizes an email without claiming payment confirmation', async () => {
    await expect(service.evaluate('tenant', 'send_automated_email', new Date(), options)).resolves.toMatchObject({
      allowed: true, billingEligible: false, operatorTestGrantId: 'grant-1' });
    expect(guard.validateGrant).toHaveBeenCalledWith({ tenantId: 'tenant', grantId: 'grant-1',
      recipientEmail: 'owned@example.test', channel: 'email' });
  });
  it.each(['send_automated_sms', 'start_automation', 'add_team_member'] as const)('does not authorize %s', async (action) => {
    await expect(service.evaluate('tenant', action, new Date(), options)).resolves.toMatchObject({ allowed: false });
  });
  it.each(['SUSPENDED', 'CANCELED', 'PAUSED'])('does not bypass %s for AI email', async (lifecycle) => {
    tenant.lifecycleStatus = lifecycle;
    await expect(service.evaluate('tenant', 'send_automated_email', new Date(), options)).resolves.toMatchObject({
      allowed: false, billingEligible: false });
  });
  it('does not bypass platform pause', async () => {
    process.env.GLOBAL_AUTOMATIONS_DISABLED = 'true';
    await expect(service.evaluate('tenant', 'send_automated_email', new Date(), options)).resolves.toMatchObject({
      allowed: false, reasons: expect.arrayContaining(['Platform automation is globally paused']) });
  });
  it('denies an expired, revoked, or mismatched grant', async () => {
    guard.validateGrant.mockResolvedValue(null as any);
    await expect(service.evaluate('tenant', 'send_automated_email', new Date(), options)).resolves.toMatchObject({
      allowed: false, operatorTestGrantId: null });
  });
  it('fails closed when the authorization service is unavailable', async () => {
    const missing = new EntitlementService({ findOne: async () => tenant } as any,
      { findOne: async () => ({ automationsEnabled: true }) } as any);
    await expect(missing.evaluate('tenant', 'send_automated_email', new Date(), options)).resolves.toMatchObject({ allowed: false });
  });
});
