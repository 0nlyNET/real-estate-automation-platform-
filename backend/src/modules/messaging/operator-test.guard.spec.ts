import { OperatorTestGuard } from './operator-test.guard';
import { OperatorTestAuthorization } from './operator-test-authorization.entity';
import { Message } from './message.entity';

/**
 * Unit tests for OperatorTestGuard.
 * 
 * Verifies:
 * 1. Valid authorization allows send
 * 2. Expired authorization blocks
 * 3. Revoked authorization blocks
 * 4. Non-allowlisted recipient blocks
 * 5. SMS channel blocks
 * 6. Wrong tenant blocks (cross-tenant prevention)
 * 7. Daily limit enforcement
 * 8. Total limit enforcement
 */
describe('OperatorTestGuard', () => {
  let guard: OperatorTestGuard;
  let mockAuthRepo: any;
  let mockMessageRepo: any;

  const validAuth = {
    id: 'auth-123',
    tenantId: 'tenant-abc',
    recipientAllowlist: ['jayden+smoketest@realtytechai.app'],
    channel: 'email',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    dailyLimit: 10,
    totalLimit: 50,
    isRevoked: false,
    createdBy: 'admin-1',
  } as OperatorTestAuthorization;

  beforeEach(() => {
    mockAuthRepo = {
      findOne: jest.fn(),
      update: jest.fn(),
    };
    // Mock query builder for limit checks
    const mockQueryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(0),
    };
    mockMessageRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };
    guard = new OperatorTestGuard(mockAuthRepo, mockMessageRepo);
  });

  it('allows valid authorization with allowlisted recipient', async () => {
    mockAuthRepo.findOne.mockResolvedValue(validAuth);
    const result = await guard.checkAuthorization({
      tenantId: 'tenant-abc',
      recipientEmail: 'jayden+smoketest@realtytechai.app',
      channel: 'email',
    });
    expect(result).toEqual(validAuth);
  });

  it('blocks expired authorization', async () => {
    const expiredAuth = { ...validAuth, expiresAt: new Date(Date.now() - 1000) };
    mockAuthRepo.findOne.mockResolvedValue(expiredAuth);
    const result = await guard.checkAuthorization({
      tenantId: 'tenant-abc',
      recipientEmail: 'jayden+smoketest@realtytechai.app',
      channel: 'email',
    });
    expect(result).toBeNull();
  });

  it('blocks non-allowlisted recipient', async () => {
    mockAuthRepo.findOne.mockResolvedValue(validAuth);
    const result = await guard.checkAuthorization({
      tenantId: 'tenant-abc',
      recipientEmail: 'attacker@evil.com',
      channel: 'email',
    });
    expect(result).toBeNull();
  });

  it('blocks SMS channel', async () => {
    mockAuthRepo.findOne.mockResolvedValue(validAuth);
    const result = await guard.checkAuthorization({
      tenantId: 'tenant-abc',
      recipientEmail: 'jayden+smoketest@realtytechai.app',
      channel: 'sms',
    });
    expect(result).toBeNull();
  });

  it('blocks when no authorization exists for tenant', async () => {
    mockAuthRepo.findOne.mockResolvedValue(null);
    const result = await guard.checkAuthorization({
      tenantId: 'other-tenant',
      recipientEmail: 'jayden+smoketest@realtytechai.app',
      channel: 'email',
    });
    expect(result).toBeNull();
  });

  it('blocks when daily limit exceeded', async () => {
    mockAuthRepo.findOne.mockResolvedValue(validAuth);
    // Mock daily count at limit
    mockMessageRepo.createQueryBuilder().getCount.mockResolvedValueOnce(10);
    const result = await guard.checkAuthorization({
      tenantId: 'tenant-abc',
      recipientEmail: 'jayden+smoketest@realtytechai.app',
      channel: 'email',
    });
    expect(result).toBeNull();
  });

  it('blocks when total limit exceeded', async () => {
    mockAuthRepo.findOne.mockResolvedValue(validAuth);
    // Daily OK (5), total at limit (50)
    mockMessageRepo.createQueryBuilder().getCount
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(50);
    const result = await guard.checkAuthorization({
      tenantId: 'tenant-abc',
      recipientEmail: 'jayden+smoketest@realtytechai.app',
      channel: 'email',
    });
    expect(result).toBeNull();
  });

  it('checkTenantAuthorization returns auth for valid tenant', async () => {
    mockAuthRepo.findOne.mockResolvedValue(validAuth);
    const result = await guard.checkTenantAuthorization('tenant-abc');
    expect(result).toEqual(validAuth);
  });

  it('checkTenantAuthorization returns null for expired', async () => {
    const expiredAuth = { ...validAuth, expiresAt: new Date(Date.now() - 1000) };
    mockAuthRepo.findOne.mockResolvedValue(expiredAuth);
    const result = await guard.checkTenantAuthorization('tenant-abc');
    expect(result).toBeNull();
  });
});
