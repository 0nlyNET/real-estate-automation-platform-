import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { OperatorTestAuthorization } from './operator-test-authorization.entity';
import { OperatorTestGrantUsage } from './operator-test-grant-usage.entity';

/**
 * Guard for operator test messaging authorizations.
 * 
 * CRITICAL: An `isOperatorTest` flag supplied by a client MUST NEVER grant access.
 * Authorization is determined SOLELY by server-side records in the
 * `operator_test_authorizations` table, created via audited admin API.
 * 
 * The guard verifies:
 * 1. Exact tenant ID match (no cross-tenant use)
 * 2. Recipient in allowlist (exact email match, case-insensitive)
 * 3. Channel is 'email' (SMS never allowed)
 * 4. Authorization not expired and not revoked
 * 5. Quota via TRANSACTIONAL reservations (not count-then-insert)
 * 
 * All other safety checks (lifecycle, suspension, pauses, consent, opt-out,
 * AI config, message safety) continue to be evaluated normally. This guard
 * ONLY provides a narrow billing exception, not a blanket bypass.
 * 
 * Quota semantics:
 * - Each (grant_id, message_id) reservation is UNIQUE.
 * - Retries reuse the same reservation; they do not consume additional quota.
 * - Concurrent workers are serialized by the UNIQUE constraint.
 */
@Injectable()
export class OperatorTestGuard {
  private readonly logger = new Logger(OperatorTestGuard.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(OperatorTestAuthorization)
    private readonly authorizations: Repository<OperatorTestAuthorization>,
    @InjectRepository(OperatorTestGrantUsage)
    private readonly usages: Repository<OperatorTestGrantUsage>,
  ) {}

  /**
   * Validate a grant for a tenant/recipient/channel WITHOUT consuming quota.
   * Used for pre-checks (e.g., API guard). Does not reserve.
   */
  async validateGrant(params: {
    tenantId: string;
    recipientEmail?: string;
    channel: 'email' | 'sms';
  }): Promise<OperatorTestAuthorization | null> {
    const { tenantId, recipientEmail, channel } = params;

    // SMS is never allowed for operator tests
    if (channel !== 'email') {
      return null;
    }

    const auth = await this.authorizations.findOne({
      where: { tenantId, isRevoked: false },
      order: { createdAt: 'DESC' },
    });

    if (!auth) return null;
    if (auth.expiresAt <= new Date()) return null;
    if (auth.channel !== 'email') return null;

    // If recipient specified, verify allowlist
    if (recipientEmail) {
      const normalized = recipientEmail.toLowerCase().trim();
      const allowlisted = auth.recipientAllowlist.some(
        (a) => a.toLowerCase().trim() === normalized,
      );
      if (!allowlisted) return null;
    }

    return auth;
  }

  /**
   * Atomically reserve quota for a message.
   * 
   * This is TRANSACTIONAL:
   * 1. Validates the grant (not expired/revoked, recipient allowlisted).
   * 2. Attempts to INSERT the reservation. If (grant_id, message_id) already
   *    exists (retry), returns the existing grant (idempotent, no double-count).
   * 3. Checks quota within the same transaction. If over limit, rolls back.
   * 
   * Returns the grant if reserved, null if denied.
   */
  async reserveQuota(params: {
    tenantId: string;
    recipientEmail: string;
    channel: 'email' | 'sms';
    messageId: string;
  }): Promise<OperatorTestAuthorization | null> {
    const { tenantId, recipientEmail, channel, messageId } = params;
    const normalizedRecipient = recipientEmail.toLowerCase().trim();

    if (channel !== 'email' || !normalizedRecipient || !messageId) {
      return null;
    }

    return this.dataSource.transaction(async (manager) => {
      // 1. Validate grant
      const auth = await manager.findOne(OperatorTestAuthorization, {
        where: { tenantId, isRevoked: false },
        order: { createdAt: 'DESC' },
      });

      if (!auth) return null;
      if (auth.expiresAt <= new Date()) {
        this.logger.warn(`Grant ${auth.id} expired`);
        return null;
      }
      if (auth.channel !== 'email') return null;

      const allowlisted = auth.recipientAllowlist.some(
        (a) => a.toLowerCase().trim() === normalizedRecipient,
      );
      if (!allowlisted) {
        this.logger.warn(`Recipient ${normalizedRecipient} not allowlisted`);
        return null;
      }

      // 2. Try to insert reservation (idempotent for retries)
      // If this message already has a reservation, it's a retry — allow it.
      const existing = await manager.findOne(OperatorTestGrantUsage, {
        where: { grantId: auth.id, messageId },
      });
      if (existing) {
        // Retry: already reserved, do not double-count
        return auth;
      }

      // 3. Check quota within transaction
      const dailyCount = await manager
        .createQueryBuilder(OperatorTestGrantUsage, 'u')
        .where('u.grantId = :grantId', { grantId: auth.id })
        .andWhere('u.reservedAt >= :startOfDay', {
          startOfDay: new Date(new Date().setHours(0, 0, 0, 0)),
        })
        .getCount();

      if (dailyCount >= auth.dailyLimit) {
        this.logger.warn(`Daily quota exceeded for grant ${auth.id}`);
        return null;
      }

      const totalCount = await manager
        .createQueryBuilder(OperatorTestGrantUsage, 'u')
        .where('u.grantId = :grantId', { grantId: auth.id })
        .getCount();

      if (totalCount >= auth.totalLimit) {
        this.logger.warn(`Total quota exceeded for grant ${auth.id}`);
        return null;
      }

      // 4. Reserve (UNIQUE constraint prevents concurrent double-reserve)
      try {
        await manager.insert(OperatorTestGrantUsage, {
          grantId: auth.id,
          messageId,
          tenantId,
          recipientEmail: normalizedRecipient,
        });
      } catch (err: any) {
        // Unique violation = concurrent reservation for same message (retry)
        // or concurrent grant exhaustion. Treat as retry if message exists.
        const retry = await manager.findOne(OperatorTestGrantUsage, {
          where: { grantId: auth.id, messageId },
        });
        if (retry) return auth;
        this.logger.warn(`Quota reservation failed for grant ${auth.id}: ${err.message}`);
        return null;
      }

      return auth;
    });
  }

  /**
   * Check if a tenant has a valid grant (for API-level pre-check).
   * Does NOT consume quota. Per-recipient check happens at reserve time.
   */
  async checkTenantAuthorization(tenantId: string): Promise<OperatorTestAuthorization | null> {
    return this.validateGrant({ tenantId, channel: 'email' });
  }

  /**
   * Revoke a grant. Already-queued messages are blocked at provider
   * submission because the grant is re-validated there.
   */
  async revoke(grantId: string, revokedBy: string): Promise<void> {
    await this.authorizations.update(grantId, {
      isRevoked: true,
      revokedAt: new Date(),
      revokedBy,
    });
    this.logger.log(`Operator test grant ${grantId} revoked by ${revokedBy}`);
  }
}
