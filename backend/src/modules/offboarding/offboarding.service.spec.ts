import { Tenant } from '../tenants/tenant.entity';
import { OffboardingService } from './offboarding.service';

// P7 regression: offboarding.start() must mark the suspension with a terminal
// source that billing recovery can never match, and must clear any
// previous-lifecycle restore target, so a late payment cannot resurrect a
// tenant mid-offboarding-retention.
describe('offboarding start terminal suspension', () => {
  it('writes a terminal suspension marker billing recovery can never match', async () => {
    const tenant = {
      id: 'tenant-offboard-1',
      lifecycleStatus: 'ACTIVE',
      servicePreviousLifecycleStatus: 'ACTIVE',
    } as Tenant;
    const savedTenants: Tenant[] = [];
    const manager = {
      getRepository: jest.fn().mockImplementation((entity: unknown) => {
        if (entity === Tenant) {
          return {
            findOneOrFail: jest.fn().mockResolvedValue(tenant),
          };
        }
        return { update: jest.fn().mockResolvedValue({ affected: 1 }) };
      }),
      save: jest.fn().mockImplementation(async (value: Tenant) => {
        savedTenants.push(value);
        return value;
      }),
    };
    const dataSource = {
      transaction: jest.fn().mockImplementation(async (work: (m: unknown) => unknown) => work(manager)),
    };
    const requestRow = {
      id: 'request-1',
      tenantId: tenant.id,
      status: 'scheduled',
      deleteAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      startedAt: null,
    };
    const requests = {
      findOneOrFail: jest.fn().mockResolvedValue(requestRow),
      save: jest.fn().mockImplementation(async (value: unknown) => value),
    };
    const service = new OffboardingService(dataSource as any, requests as any);

    await service.start(tenant.id);

    expect(savedTenants).toHaveLength(1);
    const saved = savedTenants[0];
    expect(saved.lifecycleStatus).toBe('SUSPENDED');
    // The terminal marker: restoreAfterPayment only restores 'billing'.
    expect(saved.serviceSuspensionSource).toBe('offboarding');
    // No restore target survives offboarding start.
    expect(saved.servicePreviousLifecycleStatus).toBeNull();
    expect(saved.serviceSuspensionReason).toBe('Client offboarding retention period');
    expect(requests.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'retention' }),
    );
  });
});
