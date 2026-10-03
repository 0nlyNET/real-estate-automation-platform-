import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperatorTestAuthorization } from './operator-test-authorization.entity';
import { OperatorTestGuard } from './operator-test.guard';

/**
 * Operator-restricted grant management for test messaging.
 * 
 * - Creation and revocation are AUDITED (who, when, why).
 * - Only platform operators (super_admin) can create/revoke grants.
 * - Grants are bound to exact tenant, recipient allowlist, channel, expiry.
 * - Revocation is immediate; queued work is blocked at provider submission.
 */
@Injectable()
export class OperatorTestAdminService {
  private readonly logger = new Logger(OperatorTestAdminService.name);

  constructor(
    @InjectRepository(OperatorTestAuthorization)
    private readonly authorizations: Repository<OperatorTestAuthorization>,
    private readonly guard: OperatorTestGuard,
  ) {}

  /**
   * Create a new grant. Operator-restricted (checked by controller guard).
   */
  async createGrant(params: {
    tenantId: string;
    recipientAllowlist: string[];
    channel?: 'email';
    expiresAt: Date;
    dailyLimit?: number;
    totalLimit?: number;
    createdBy: string;
    purpose?: string;
  }): Promise<OperatorTestAuthorization> {
    // Validate inputs
    if (!params.tenantId) throw new ForbiddenException('Tenant ID required');
    if (!params.recipientAllowlist?.length) {
      throw new ForbiddenException('Recipient allowlist required (non-empty)');
    }
    if (params.channel && params.channel !== 'email') {
      throw new ForbiddenException('Only email channel supported for operator tests');
    }
    if (params.expiresAt <= new Date()) {
      throw new ForbiddenException('Expiry must be in the future');
    }

    // Normalize recipients
    const normalized = params.recipientAllowlist.map((r) => r.toLowerCase().trim());

    const grant = this.authorizations.create({
      tenantId: params.tenantId,
      recipientAllowlist: normalized,
      channel: 'email',
      expiresAt: params.expiresAt,
      dailyLimit: params.dailyLimit ?? 10,
      totalLimit: params.totalLimit ?? 50,
      isRevoked: false,
      createdBy: params.createdBy,
      purpose: params.purpose || null,
    });

    const saved = await this.authorizations.save(grant);

    this.logger.log(
      `Operator test grant created: ${saved.id} for tenant ${params.tenantId} ` +
      `by ${params.createdBy}, expires ${params.expiresAt.toISOString()}, ` +
      `recipients: ${normalized.join(', ')}`,
    );

    return saved;
  }

  /**
   * Revoke a grant. Operator-restricted (checked by controller guard).
   */
  async revokeGrant(grantId: string, revokedBy: string): Promise<void> {
    await this.guard.revoke(grantId, revokedBy);
  }

  /**
   * List grants for a tenant (operator view).
   */
  async listGrants(tenantId: string): Promise<OperatorTestAuthorization[]> {
    return this.authorizations.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }
}
