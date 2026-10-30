import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OperatorTestAuthorization } from './operator-test-authorization.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { isUUID } from 'class-validator';

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
    private readonly dataSource: DataSource,
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
    if (!isUUID(params.tenantId || '') || !isUUID(params.createdBy || '')) {
      throw new ForbiddenException('Valid tenant and operator identities required');
    }
    if (!Array.isArray(params.recipientAllowlist) || !params.recipientAllowlist.length) {
      throw new ForbiddenException('Recipient allowlist required (non-empty)');
    }
    if (params.channel && params.channel !== 'email') {
      throw new ForbiddenException('Only email channel supported for operator tests');
    }
    if (!(params.expiresAt instanceof Date) || !Number.isFinite(params.expiresAt.getTime()) ||
        params.expiresAt <= new Date() || params.expiresAt.getTime() > Date.now() + 7 * 86_400_000) {
      throw new ForbiddenException('Expiry must be valid, in the future, and within seven days');
    }

    for (const [value, maximum] of [[params.dailyLimit ?? 10, 10], [params.totalLimit ?? 50, 50]]) {
      if (!Number.isInteger(value) || value < 1 || value > maximum) {
        throw new ForbiddenException('Grant quotas exceed operator test limits');
      }
    }
    // Normalize recipients
    const normalized = [...new Set(params.recipientAllowlist.map((r) => String(r).toLowerCase().trim()))];

    if (normalized.length !== 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized[0])) {
      throw new ForbiddenException('Exactly one valid test recipient is required');
    }

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

    const saved = await this.dataSource.transaction(async (manager) => {
      const savedGrant = await manager.save(OperatorTestAuthorization, grant);
      await manager.save(AuditLog, {
        tenantId: params.tenantId,
        actorId: params.createdBy,
        actorType: 'platform_operator',
        action: 'operator_test_grant_created',
        eventType: 'operator_test_grant_created',
        resourceType: 'operator_test_grant', resourceId: savedGrant.id,
        method: 'POST', path: '/admin/operator-test/grants', statusCode: 201,
        metadata: { purpose: params.purpose || null, recipientAllowlist: normalized,
          expiresAt: params.expiresAt.toISOString(), dailyLimit: savedGrant.dailyLimit,
          totalLimit: savedGrant.totalLimit },
      });
      return savedGrant;
    });

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
    if (!isUUID(grantId || '') || !isUUID(revokedBy || '')) {
      throw new ForbiddenException('Valid grant and operator identities required');
    }
    await this.dataSource.transaction(async (manager) => {
      const grant = await manager.findOne(OperatorTestAuthorization, {
        where: { id: grantId }, lock: { mode: 'pessimistic_write' },
      });
      if (!grant) throw new ForbiddenException('Grant not found');
      await manager.update(OperatorTestAuthorization, grantId, {
        isRevoked: true, revokedAt: new Date(), revokedBy,
      });
      await manager.save(AuditLog, {
        tenantId: grant.tenantId, actorId: revokedBy, actorType: 'platform_operator',
        action: 'operator_test_grant_revoked', eventType: 'operator_test_grant_revoked',
        resourceType: 'operator_test_grant', resourceId: grantId,
        method: 'DELETE', path: `/admin/operator-test/grants/${grantId}`, statusCode: 200,
      });
    });
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
