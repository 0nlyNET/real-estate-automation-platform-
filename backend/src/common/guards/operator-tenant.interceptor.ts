import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Fail-closed tenant scoping for platform operators.
 *
 * A platform operator (super_admin / staff) who reaches a tenant-scoped API
 * route WITHOUT an explicitly selected tenant context is rejected. This
 * prevents the historic bug where a super admin using tenant-facing UI silently
 * wrote into their own operator tenant instead of the client they meant to
 * assist.
 *
 * Explicit tenant context means exactly one of:
 *  - user.operatorMode   — entered via POST /admin/operator-mode with a chosen tenant
 *  - user.impersonatedBy — impersonating a specific tenant user (existing flow)
 *
 * There is intentionally NO fallback to the operator's own user.tenantId, and
 * client-supplied tenant IDs in the request (params/body/query) are never
 * trusted — the effective tenant always comes from the signed session.
 *
 * This is an interceptor (not a guard) because it must run AFTER JwtAuthGuard
 * populates request.user. It is registered before WorkspaceAccessInterceptor
 * so the fail-closed rejection happens before any tenant logic executes.
 *
 * Routes that platform operators legitimately use without a tenant context:
 *  - /admin/*   (platform administration)
 *  - /auth/*    (sign-in, session, password flows)
 *  - /public/*  (public endpoints)
 *  - /health*   (health checks)
 *  - /me, /me/* (returns operatorTenantRequired so the UI can fail closed too)
 */
const OPERATOR_ALLOWLIST: RegExp[] = [
  /^\/admin(\/|$)/,
  /^\/auth(\/|$)/,
  /^\/public(\/|$)/,
  /^\/health(\/|$)/,
  /^\/me(\/|$)/,
];

export const OPERATOR_TENANT_REQUIRED_CODE = 'OPERATOR_TENANT_REQUIRED';

@Injectable()
export class OperatorTenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<any>();
    const user = request?.user;
    if (!user) return next.handle();

    const isOperator = user.platformAdmin === true || user.platformOperator === true;
    if (!isOperator) return next.handle();

    // Explicit tenant context present — tenantId is already pinned by the JWT strategy.
    if (user.impersonatedBy || user.operatorMode?.tenantId) return next.handle();

    const path = String(request?.originalUrl || request?.url || '/').split('?')[0];
    if (OPERATOR_ALLOWLIST.some((pattern) => pattern.test(path))) return next.handle();

    throw new ForbiddenException({
      code: OPERATOR_TENANT_REQUIRED_CODE,
      message:
        'Select a client workspace from Admin before using tenant features. ' +
        'Platform operators cannot use tenant routes without an explicitly selected tenant.',
    });
  }
}
