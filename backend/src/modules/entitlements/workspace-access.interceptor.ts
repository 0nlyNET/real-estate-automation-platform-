import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EntitlementService } from './entitlement.service';

const SETUP_ACCESS = 'workspace_setup_access';
export const AllowSetupAccess = () => SetMetadata(SETUP_ACCESS, true);

/** Interceptors run after authentication guards, including plain AuthGuard('jwt'). */
@Injectable()
export class WorkspaceAccessInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector, private readonly entitlements: EntitlementService) {}

  async intercept(context: ExecutionContext, next: CallHandler) {
    const user = context.switchToHttp().getRequest().user;
    if (!user || (user.platformOperator === true && !user.impersonatedBy) ||
        this.reflector.getAllAndOverride<boolean>(SETUP_ACCESS, [context.getHandler(), context.getClass()])) {
      return next.handle();
    }
    const access = await this.entitlements.workspaceAccess(user.tenantId);
    if (!access.allowed) {
      throw new ForbiddenException({
        code: access.billingEligible ? 'WORKSPACE_SUSPENDED' : 'PAYMENT_REQUIRED',
        message: access.reason,
      });
    }
    return next.handle();
  }
}
