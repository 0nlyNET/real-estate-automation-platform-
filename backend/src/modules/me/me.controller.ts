import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantsService } from '../tenants/tenants.service';

@Controller('me')
export class MeController {
  constructor(private readonly tenants: TenantsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('plan')
  async plan(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      return {
        tenantId,
        plan: 'trial',
        status: 'trialing',
        trialEndsAt: null,
        currentPeriodEnd: null,
      };
    }
    return {
      tenantId: tenant.id,
      plan: tenant.plan,
      status: tenant.status,
      trialEndsAt: tenant.trialEndsAt ? tenant.trialEndsAt.toISOString() : null,
      currentPeriodEnd: tenant.currentPeriodEnd ? tenant.currentPeriodEnd.toISOString() : null,
    };
  }
}
