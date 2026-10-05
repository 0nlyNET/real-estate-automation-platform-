import { EntitlementService } from '../entitlements/entitlement.service';
import { AllowSetupAccess } from '../entitlements/workspace-access.interceptor';
import { Controller, Get, Req, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantsService } from '../tenants/tenants.service';
import { describeServiceState } from '../service-control/service-control.service';

@AllowSetupAccess()
@Controller('me')
export class MeController {
  private readonly logger = new Logger(MeController.name);
  constructor(private readonly tenants: TenantsService, private readonly entitlements: EntitlementService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async me(@Req() req: any) {
    const start = Date.now();
    const requestId = Math.random().toString(36).substring(7);
    this.logger.log(`[${requestId}] /me start - user: ${req.user?.email}, tenantId: ${req.user?.tenantId}`);
    
    const isOperator = req.user?.platformAdmin === true || req.user?.platformOperator === true;
    const hasExplicitTenant = Boolean(req.user?.impersonatedBy || req.user?.operatorMode?.tenantId);
    
    const wsStart = Date.now();
    const serviceAccess = await this.entitlements.workspaceAccess(req.user?.tenantId);
    const wsDuration = Date.now() - wsStart;
    this.logger.log(`[${requestId}] workspaceAccess took ${wsDuration}ms`);
    
    const total = Date.now() - start;
    this.logger.log(`[${requestId}] /me complete - total ${total}ms`);
    
    return {
      serviceAccess,
      userId: req.user?.sub || null,
      tenantId: req.user?.tenantId || null,
      role: req.user?.role || null,
      email: req.user?.email || null,
      isPlatformAdmin: req.user?.platformAdmin === true,
      platformRole: req.user?.platformRole || null,
      impersonated: Boolean(req.user?.impersonatedBy),
      impersonatedBy: req.user?.impersonatedBy || null,
      operatorMode: req.user?.operatorMode || null,
      // Fail-closed signal for the /app/* UI: a platform operator without an
      // explicitly selected tenant must not see tenant UI.
      operatorTenantRequired: isOperator && !hasExplicitTenant,
      sessionExpiresAt: req.user?.sessionExpiresAt || null,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('plan')
  async plan(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    const t = await this.tenants.findById(tenantId);

    if (!t) {
      return {
        plan: 'free',
        status: 'incomplete',
        billingInterval: 'month',
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        cancelAt: null,
        stripeSubscriptionStatus: null,
        lifecycleStatus: 'ONBOARDING',
        serviceState: {
          state: 'onboarding',
          label: 'Workspace unavailable',
          reason: 'Workspace was not found.',
          graceEndsAt: null,
        },
        serviceSuspendedAt: null,
        serviceSuspensionReason: null,
        serviceSuspensionSource: null,
        serviceRestoredAt: null,
      };
    }

    return {
      serviceAccess: await this.entitlements.workspaceAccess(tenantId),
      plan: t.plan,
      status: t.status,
      billingInterval: t.billingInterval || 'month',
      trialEndsAt: t.trialEndsAt || null,
      currentPeriodEnd: t.currentPeriodEnd || null,
      cancelAtPeriodEnd: Boolean(t.cancelAtPeriodEnd),
      cancelAt: t.cancelAt || null,
      stripeSubscriptionStatus: t.stripeSubscriptionStatus || null,
      lifecycleStatus: t.lifecycleStatus,
      serviceState: describeServiceState(t),
      serviceSuspendedAt: t.serviceSuspendedAt || null,
      serviceSuspensionReason: t.serviceSuspensionReason || null,
      serviceSuspensionSource: t.serviceSuspensionSource || null,
      serviceRestoredAt: t.serviceRestoredAt || null,
    };
  }
}
