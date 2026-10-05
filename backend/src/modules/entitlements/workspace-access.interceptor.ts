import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor, SetMetadata, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OperatorTestGuard } from '../messaging/operator-test.guard';
import { EntitlementService } from './entitlement.service';
import { requestIdOf } from '../../common/request-diagnostics';

const OPERATOR_EMAIL_ACCESS = 'operator_test_email_access';
export const AllowOperatorTestEmailAccess = () => SetMetadata(OPERATOR_EMAIL_ACCESS, true);

const SETUP_ACCESS = 'workspace_setup_access';
export const AllowSetupAccess = () => SetMetadata(SETUP_ACCESS, true);

/** Interceptors run after authentication guards, including plain AuthGuard('jwt'). */
@Injectable()
export class WorkspaceAccessInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly entitlements: EntitlementService,
    @Optional() private readonly operatorTests?: OperatorTestGuard) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const emailAccess = this.reflector.getAllAndOverride<boolean>(OPERATOR_EMAIL_ACCESS,
      [context.getHandler(), context.getClass()]);
    // Operator reads/setup retain their explicit tenant access. Manual email
    // submission must still obtain a server grant when the tenant is unpaid;
    // otherwise the lower send gate never receives its authorization identity.
    const scopedOperatorSend = user?.platformOperator === true && !user.impersonatedBy &&
      user.operatorMode?.tenantId === user.tenantId && request.method === 'POST' &&
      emailAccess && Boolean(request.body?.leadId);
    if (!user || (user.platformOperator === true && !user.impersonatedBy && !scopedOperatorSend) ||
        this.reflector.getAllAndOverride<boolean>(SETUP_ACCESS, [context.getHandler(), context.getClass()])) {
      return next.handle();
    }
    const access = await this.entitlements.workspaceAccess(user.tenantId, requestIdOf(request));
    if (!access.allowed) {
      if (emailAccess && request.body?.channel !== 'sms' &&
          ['ACTIVE', 'TESTING', 'ONBOARDING'].includes(access.lifecycleStatus || '')) {
        const grant = await this.operatorTests?.checkTenantAuthorization(user.tenantId);
        if (grant) {
          request.isOperatorTest = true;
          request.operatorTestAuthorizationId = grant.id;
          return next.handle();
        }
      }
      // P8: billing-suspended tenants keep server-enforced READ-ONLY access —
      // safe reads (GET) pass through, but mutations still 403 here and every
      // ProtectedServiceAction stays denied in EntitlementService.evaluate().
      // Manual/safety suspensions remain fully strict.
      if (access.billingSuspended && request.method === 'GET') {
        return next.handle();
      }
      throw new ForbiddenException({
        code: access.billingEligible ? 'WORKSPACE_SUSPENDED' : 'PAYMENT_REQUIRED',
        message: access.reason,
      });
    }
    return next.handle();
  }
}
