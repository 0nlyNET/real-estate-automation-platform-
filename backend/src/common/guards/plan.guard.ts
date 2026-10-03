import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../modules/tenants/tenant.entity';
import { billingEligibility } from '../../modules/entitlements/entitlement.service';
import { OperatorTestGuard } from '../../modules/messaging/operator-test.guard';

export const REQUIRE_SERVICE_ACCESS_KEY = 'require_service_access';

// Use this on managed-service routes that require an available workspace.
export const RequireServiceAccess = () =>
  SetMetadata(REQUIRE_SERVICE_ACCESS_KEY, true);

@Injectable()
export class ServiceAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly operatorTestGuard: OperatorTestGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_SERVICE_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest<any>();
    const tenantId = req.user?.tenantId;
    const tenant = tenantId ? await this.tenantRepo.findOne({ where: { id: tenantId } }) : null;
    
    // Lifecycle check: NEVER bypassed, even for operator tests
    // Suspended/canceled tenants cannot send, period.
    const lifecycleOk = tenant && !['SUSPENDED', 'CANCELED'].includes(tenant.lifecycleStatus);
    if (!lifecycleOk) {
      throw new ForbiddenException('This workspace is not available');
    }

    // Billing check: normal path
    const billing = billingEligibility(tenant);
    if (billing.allowed) {
      return true;
    }

    // Narrow operator-test exception: ONLY for billing, NOT for lifecycle.
    // SCOPED: Only applies to messaging endpoints. A test grant does NOT
    // authorize other managed-service actions (dashboard, settings, etc.).
    // Per-recipient allowlist is enforced at message send time.
    // billingEligible remains false; we record a distinct authorization.
    const path = String(req.originalUrl || req.url || '').split('?')[0];
    const isMessagingPath = /^\/messaging(\/|$)/.test(path) || /^\/api\/messaging(\/|$)/.test(path);
    
    if (isMessagingPath) {
      const operatorTestAuth = await this.operatorTestGuard.checkTenantAuthorization(tenantId);
      if (operatorTestAuth) {
        // Mark the request so downstream code flags messages as operator tests
        // DO NOT set billingEligible=true; keep it false and record distinct auth
        req.isOperatorTest = true;
        req.operatorTestAuthorizationId = operatorTestAuth.id;
        return true;
      }
    }

    throw new ForbiddenException('This workspace is not available');
  }
}
