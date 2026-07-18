import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantsService } from '../tenants/tenants.service';

@Controller('me')
export class MeController {
  constructor(private readonly tenants: TenantsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async me(@Req() req: any) {
    return {
      userId: req.user?.sub || null,
      tenantId: req.user?.tenantId || null,
      role: req.user?.role || null,
      email: req.user?.email || null,
      isPlatformAdmin: req.user?.platformAdmin === true,
      impersonated: Boolean(req.user?.impersonatedBy),
      impersonatedBy: req.user?.impersonatedBy || null,
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
        status: 'active',
        billingInterval: 'month',
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        cancelAt: null,
        stripeSubscriptionStatus: null,
      };
    }

    return {
      plan: t.plan,
      status: t.status,
      billingInterval: t.billingInterval || 'month',
      trialEndsAt: t.trialEndsAt || null,
      currentPeriodEnd: t.currentPeriodEnd || null,
      cancelAtPeriodEnd: Boolean(t.cancelAtPeriodEnd),
      cancelAt: t.cancelAt || null,
      stripeSubscriptionStatus: t.stripeSubscriptionStatus || null,
    };
  }
}
