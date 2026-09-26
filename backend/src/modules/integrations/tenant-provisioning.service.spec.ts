import { TenantProvisioningService } from './tenant-provisioning.service';

describe('TenantProvisioningService', () => {
  function harness(options?: {
    blockers?: Array<{ category: string }>;
    emailError?: Error;
    lifecycleStatus?: string;
    provisioningStatus?: string;
    sendgridSummaryStatus?: string;
    emailEnabled?: boolean;
    recipient?: string | null;
    alignResult?: { ok: boolean; reason: string; brandIdentity?: string; provisionedIdentity?: string };
    testResult?: { ok: boolean; error?: string };
    testThrows?: Error;
    lastAttemptAt?: string | null;
  }) {
    const tenant: any = {
      id: 'tenant-a',
      lifecycleStatus: options?.lifecycleStatus || 'ONBOARDING',
      provisioningStatus:
        options?.provisioningStatus || 'WAITING_FOR_CLIENT',
    };
    const twilio = { provisionTenant: jest.fn().mockResolvedValue({ id: 'sms-a' }) };
    const email = {
      provisionTenant: options?.emailError
        ? jest.fn().mockRejectedValue(options.emailError)
        : jest.fn().mockResolvedValue({ id: 'email-a' }),
    };
    const resources = {
      twilio: { display: { complianceStatus: 'approved' }, status: 'testing' },
      sendgrid: { status: options?.sendgridSummaryStatus || 'testing' },
    };
    const integrations = {
      tenantSummary: jest.fn().mockResolvedValue(resources),
      testTenantSendGrid: options?.testThrows
        ? jest.fn().mockRejectedValue(options.testThrows)
        : jest.fn().mockResolvedValue(options?.testResult || { ok: true }),
    };
    const legacyCredentials = { find: jest.fn().mockResolvedValue([]), remove: jest.fn() };
    const tenants = {
      findOne: jest.fn().mockResolvedValue(tenant),
      save: jest.fn(async (value) => value),
    };
    const readiness = {
      blockers: options?.blockers || [],
      enabledServices: { sms: true, email: options?.emailEnabled ?? true },
      ready: false,
    };
    const onboardingRecord: any = {
      emailEnabled: options?.emailEnabled ?? true,
      providerTests: options?.lastAttemptAt
        ? { sendgridAutoTestLastAttemptedAt: options.lastAttemptAt }
        : {},
    };
    const onboarding = {
      readiness: jest.fn().mockResolvedValue(readiness),
      getOrCreate: jest.fn().mockResolvedValue(onboardingRecord),
      autoAlignApprovedEmailIdentity: jest.fn().mockResolvedValue(
        options?.alignResult || { ok: true, aligned: true, reason: 'auto_aligned' },
      ),
      connectionTestRecipient: jest.fn().mockResolvedValue(
        options?.recipient === undefined ? 'control@example.com' : options.recipient,
      ),
      noteAutoConnectionTestAttempt: jest.fn().mockResolvedValue({}),
    };
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
    return { service, tenant, twilio, email, integrations, onboarding, operations };
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

  it('auto-runs the SendGrid connection test after identity provisioning reaches a testable state', async () => {
    const item = harness();
    await expect(item.service.reconcileTenantProvisioning('tenant-a')).resolves.toMatchObject({
      ok: true,
      status: 'TESTING',
    });
    expect(item.onboarding.autoAlignApprovedEmailIdentity).toHaveBeenCalledWith('tenant-a');
    expect(item.integrations.testTenantSendGrid).toHaveBeenCalledWith('tenant-a', {
      toEmail: 'control@example.com',
    });
    expect(item.onboarding.noteAutoConnectionTestAttempt).toHaveBeenCalledWith(
      'tenant-a',
      'sendgrid',
      'ok',
      undefined,
    );
  });

  it('skips the auto test when the identity is already verified', async () => {
    const item = harness({ sendgridSummaryStatus: 'ready' });
    await item.service.reconcileTenantProvisioning('tenant-a');
    expect(item.integrations.testTenantSendGrid).not.toHaveBeenCalled();
  });

  it('never auto-sends a connection test for an ACTIVE tenant', async () => {
    const item = harness({ lifecycleStatus: 'ACTIVE' });
    await item.service.reconcileTenantProvisioning('tenant-a');
    expect(item.integrations.testTenantSendGrid).not.toHaveBeenCalled();
  });

  it('skips the auto test without a controlled recipient and does not break provisioning', async () => {
    const item = harness({ recipient: null });
    await expect(item.service.reconcileTenantProvisioning('tenant-a')).resolves.toMatchObject({
      ok: true,
      status: 'TESTING',
    });
    expect(item.integrations.testTenantSendGrid).not.toHaveBeenCalled();
    expect(item.onboarding.noteAutoConnectionTestAttempt).not.toHaveBeenCalled();
  });

  it('throttles automated attempts to the retry cadence', async () => {
    const item = harness({ lastAttemptAt: new Date().toISOString() });
    await item.service.reconcileTenantProvisioning('tenant-a');
    expect(item.integrations.testTenantSendGrid).not.toHaveBeenCalled();
  });

  it('surfaces a failed auto test as a deduplicated owner exception without breaking provisioning', async () => {
    const item = harness({ testResult: { ok: false, error: 'SendGrid client test email failed (403)' } });
    await expect(item.service.reconcileTenantProvisioning('tenant-a')).resolves.toMatchObject({
      ok: true,
      status: 'TESTING',
    });
    expect(item.onboarding.noteAutoConnectionTestAttempt).toHaveBeenCalledWith(
      'tenant-a',
      'sendgrid',
      'failed',
      'SendGrid client test email failed (403)',
    );
    expect(item.operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        title: 'Automated SendGrid connection test failed',
        priority: 'high',
        dedupeOpen: true,
      }),
    );
  });

  it('treats a thrown test error as a failed attempt and keeps provisioning alive', async () => {
    const item = harness({ testThrows: new Error('socket hang up') });
    await expect(item.service.reconcileTenantProvisioning('tenant-a')).resolves.toMatchObject({
      ok: true,
    });
    expect(item.onboarding.noteAutoConnectionTestAttempt).toHaveBeenCalledWith(
      'tenant-a',
      'sendgrid',
      'failed',
      'socket hang up',
    );
  });

  it('surfaces an identity mismatch to the owner instead of silently overriding it', async () => {
    const item = harness({
      alignResult: {
        ok: false,
        reason: 'mismatch',
        brandIdentity: 'owner@lakeviewrealty.com',
        provisionedIdentity: 'lakeview-9f3ac2@mg.realtytechai.app',
      },
    });
    await item.service.reconcileTenantProvisioning('tenant-a');
    expect(item.operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        title: 'Approved email identity does not match the provisioned sender',
        dedupeOpen: true,
      }),
    );
    const description = String(
      item.operations.createTask.mock.calls.find((call: any[]) =>
        String(call[0]?.title || '').includes('does not match'),
      )?.[0]?.description || '',
    );
    expect(description).toContain('owner@lakeviewrealty.com');
    expect(description).toContain('lakeview-9f3ac2@mg.realtytechai.app');
  });

  it('retries the auto test on later scan passes while the tenant stays in TESTING', async () => {
    const item = harness({ provisioningStatus: 'TESTING' });
    await expect(item.service.reconcileTenantProvisioning('tenant-a')).resolves.toMatchObject({
      ok: true,
      status: 'TESTING',
    });
    expect(item.integrations.testTenantSendGrid).toHaveBeenCalledWith('tenant-a', {
      toEmail: 'control@example.com',
    });
  });
});
