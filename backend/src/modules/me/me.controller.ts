import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';

@UseGuards(JwtAuthGuard)
@Controller()
export class MeController {
  constructor(
    private readonly usersService: UsersService,
    private readonly tenantsService: TenantsService,
  ) {}

  @Get('me')
  async me(@Req() req: any) {
    const payload = req.user;
    const email = String(payload?.email || '');
    const user = email ? await this.usersService.findByEmail(email) : null;
    const tenantId = user?.tenantId || payload?.tenantId;
    const tenant = tenantId ? await this.tenantsService.findById(tenantId) : null;
    return {
      id: user?.id || payload?.sub,
      email: user?.email || payload?.email,
      role: user?.role || payload?.role,
      tenantId,
      tenant: tenant
        ? { id: tenant.id, name: tenant.name, slug: tenant.slug }
        : null,
    };
  }

  @Get('me/plan')
  async plan(@Req() req: any) {
    // Placeholder plan info for MVP.
    // Later: store per-tenant plan in DB + Stripe subscriptions.
    const tenantId = req.user?.tenantId;
    return {
      plan: 'Starter',
      status: 'trial',
      tenantId,
      limits: {
        leadsPerMonth: 1000,
        smsPerMonth: 2000,
        emailPerMonth: 5000,
      },
    };
  }
}
