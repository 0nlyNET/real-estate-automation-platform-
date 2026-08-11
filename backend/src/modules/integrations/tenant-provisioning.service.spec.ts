import { TenantProvisioningService } from './tenant-provisioning.service';

describe('TenantProvisioningService', () => {
  function harness(options?: { blockers?: Array<{ category: string }>; emailError?: Error }) {
    const tenant: any = {
      id: 'tenant-a',
      lifecycleStatus: 'ONBOARDING',
      provisioningStatus: 'WAITING_FOR_CLIENT',
    };
    const twilio = { provisionTenant: jest.fn().mockResolvedValue({ id: 'sms-a' }) };
    const email = {
      provisionTenant: options?.emailError
        ? jest.fn().mockRejectedValue(options.emailError)
        : jest.fn().mockResolvedValue({ id: 'email-a' }),
    };
    const resources = {
      twilio: { display: { complianceStatus: 'approved' }, status: 'testing' },
      sendgrid: { status: 'testing' },
    };
    const integrations = { tenantSummary: jest.fn().mockResolvedValue(resources) };
    const legacyCredentials = { find: jest.fn().mockResolvedValue([]), remove: jest.fn() };
    const tenants = {
      findOne: jest.fn().mockResolvedValue(tenant),
      save: jest.fn(async (value) => value),
    };
    const readiness = {
      blockers: options?.blockers || [],
      enabledServices: { sms: true, email: true },
      ready: false,
    };
    const onboarding = { readiness: jest.fn().mockResolvedValue(readiness) };
    const operations = {
      createTask: jest.fn().mockResolvedValue({}),
      resolveRecoverableTasks: jest.fn().mockResolvedValue(1),
    };
    const service = new TenantProvisioningService(
      twilio as any,
      email as any,
      integrations as any,
      legacyCredentials as any,
      tenants as any,
      onboarding as any,
      operations as any,
    );
    return { service, tenant, twilio, email, operations };
  }

  it('waits without creating provider resources until client information is ready', async () => {
    const item = harness({ blockers: [{ category: 'client_information' }] });
    await expect(item.service.reconcileTenantProvisioning('tenant-a')).resolves.toMatchObject({
      ok: true,
      status: 'WAITING_FOR_CLIENT',
    });
    expect(item.twilio.provisionTenant).not.toHaveBeenCalled();
    expect(item.email.provisionTenant).not.toHaveBeenCalled();
  });

  it('persists TESTING after both tenant providers reconcile and resolves a recovered task', async () => {
    const item = harness();
    await expect(item.service.reconcileTenantProvisioning('tenant-a')).resolves.toMatchObject({
      ok: true,
      status: 'TESTING',
    });
    expect(item.email.provisionTenant).toHaveBeenCalledWith('tenant-a');
    expect(item.twilio.provisionTenant).toHaveBeenCalledWith('tenant-a');
    expect(item.operations.resolveRecoverableTasks).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a', category: 'provider_configuration' }),
    );
  });

  it('persists ACTION_REQUIRED and creates one deduplicated owner exception', async () => {
    const item = harness({ emailError: new Error('sender verification failed') });
    await expect(item.service.reconcileTenantProvisioning('tenant-a')).resolves.toMatchObject({
      ok: false,
      status: 'ACTION_REQUIRED',
      errors: ['sender verification failed'],
    });
    expect(item.operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        priority: 'high',
        dedupeOpen: true,
      }),
    );
  });

  it('retries a transient provider failure without immediately paging the owner', async () => {
    const item = harness({
      emailError: new Error('SendGrid request failed (503): temporarily unavailable'),
    });
    await expect(
      item.service.reconcileTenantProvisioning('tenant-a'),
    ).rejects.toThrow('503');
    expect(item.tenant.provisioningStatus).toBe('SMS_PROVISIONING');
    expect(item.operations.createTask).not.toHaveBeenCalled();
  });
});
