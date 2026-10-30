import { OperatorTestGuard } from './operator-test.guard';
import { OperatorTestAuthorization } from './operator-test-authorization.entity';
import { OperatorTestGrantUsage } from './operator-test-grant-usage.entity';

/**
 * Unit tests for OperatorTestGuard (transactional version).
 * 
 * Verifies:
 * 1. Valid grant validates
 * 2. Expired/revoked blocks
 * 3. Non-allowlisted recipient blocks
 * 4. SMS blocks
 * 5. Cross-tenant blocks
 * 6. Quota reservation is transactional and idempotent
 */
describe('OperatorTestGuard', () => {
  let guard: OperatorTestGuard;
  let mockDataSource: any;
  let mockAuthRepo: any;
  let mockUsageRepo: any;

  const validAuth = {
    id: 'auth-123',
    tenantId: 'tenant-abc',
    recipientAllowlist: ['jayden+smoketest@realtytechai.app'],
    channel: 'email',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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
    mockUsageRepo = {};
    
    // Mock transactional manager
    const mockManager = {
      findOne: jest.fn(),
      insert: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(0),
      }),
    };
    mockDataSource = {
      transaction: jest.fn((fn: any) => fn(mockManager)),
    };
    // Expose manager for test assertions
    (mockDataSource as any).__manager = mockManager;
    
    guard = new OperatorTestGuard(mockDataSource, mockAuthRepo, mockUsageRepo);
  });

  describe('validateGrant', () => {
    it('validates valid grant with allowlisted recipient', async () => {
      mockAuthRepo.findOne.mockResolvedValue(validAuth);
      const result = await guard.validateGrant({
        tenantId: 'tenant-abc',
        recipientEmail: 'jayden+smoketest@realtytechai.app',
        channel: 'email',
      });
      expect(result).toEqual(validAuth);
    });

    it('blocks expired grant', async () => {
      const expired = { ...validAuth, expiresAt: new Date(Date.now() - 1000) };
      mockAuthRepo.findOne.mockResolvedValue(expired);
      const result = await guard.validateGrant({
        tenantId: 'tenant-abc',
        recipientEmail: 'jayden+smoketest@realtytechai.app',
        channel: 'email',
      });
      expect(result).toBeNull();
    });

    it('blocks non-allowlisted recipient', async () => {
      mockAuthRepo.findOne.mockResolvedValue(validAuth);
      const result = await guard.validateGrant({
        tenantId: 'tenant-abc',
        recipientEmail: 'attacker@evil.com',
        channel: 'email',
      });
      expect(result).toBeNull();
    });

    it('blocks SMS channel', async () => {
      const result = await guard.validateGrant({
        tenantId: 'tenant-abc',
        recipientEmail: 'jayden+smoketest@realtytechai.app',
        channel: 'sms',
      });
      expect(result).toBeNull();
    });

    it('blocks when no grant exists (cross-tenant)', async () => {
      mockAuthRepo.findOne.mockResolvedValue(null);
      const result = await guard.validateGrant({
        tenantId: 'other-tenant',
        channel: 'email',
      });
      expect(result).toBeNull();
    });
  });

  describe('reserveQuota', () => {
    it('reserves quota for valid grant', async () => {
      const manager = (mockDataSource as any).__manager;
      manager.findOne
        .mockResolvedValueOnce(validAuth) // grant lookup
        .mockResolvedValueOnce(null); // no existing reservation
      
      const result = await guard.reserveQuota({
        tenantId: 'tenant-abc',
        recipientEmail: 'jayden+smoketest@realtytechai.app',
        channel: 'email',
        messageId: 'msg-123',
        grantId: validAuth.id,
      });
      
      expect(result).toEqual(validAuth);
      expect(manager.insert).toHaveBeenCalled();
      expect(manager.findOne).toHaveBeenCalledWith(OperatorTestAuthorization, expect.objectContaining({
        where: { id: validAuth.id, tenantId: validAuth.tenantId, isRevoked: false },
        lock: { mode: 'pessimistic_write' },
      }));
    });

    it('is idempotent for retries (same message_id)', async () => {
      const manager = (mockDataSource as any).__manager;
      manager.findOne
        .mockResolvedValueOnce(validAuth) // grant lookup
        .mockResolvedValueOnce({ id: 'usage-1', grantId: validAuth.id, tenantId: validAuth.tenantId, recipientEmail: validAuth.recipientAllowlist[0] }); // existing reservation
      
      const result = await guard.reserveQuota({
        tenantId: 'tenant-abc',
        recipientEmail: 'jayden+smoketest@realtytechai.app',
        channel: 'email',
        messageId: 'msg-123',
        grantId: validAuth.id,
      });
      
      expect(result).toEqual(validAuth);
      // Should NOT insert again for retry
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('blocks when daily quota exceeded', async () => {
      const manager = (mockDataSource as any).__manager;
      manager.findOne
        .mockResolvedValueOnce(validAuth)
        .mockResolvedValueOnce(null);
      // Daily count at limit
      manager.createQueryBuilder().getCount.mockResolvedValueOnce(10);
      
      const result = await guard.reserveQuota({
        tenantId: 'tenant-abc',
        recipientEmail: 'jayden+smoketest@realtytechai.app',
        channel: 'email',
        messageId: 'msg-456',
        grantId: validAuth.id,
      });
      
      expect(result).toBeNull();
      expect(manager.insert).not.toHaveBeenCalled();
    });
  });

  describe('checkTenantAuthorization', () => {
    it('returns grant for valid tenant', async () => {
      mockAuthRepo.findOne.mockResolvedValue(validAuth);
      const result = await guard.checkTenantAuthorization('tenant-abc');
      expect(result).toEqual(validAuth);
    });
  });
});
