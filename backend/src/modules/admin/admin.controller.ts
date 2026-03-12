import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { AuthService } from '../auth/auth.service';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly auth: AuthService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('owner')
  @Get('overview')
  async overview() {
    return this.admin.overview();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('owner')
  @Get('system-health')
  async systemHealth() {
    return this.admin.systemHealth();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('owner')
  @Get('tenants')
  async listTenants() {
    const items = await this.admin.listTenants();
    return items.map((t: any) => ({
      id: t.id,
      name: t.name,
      plan: t.plan,
      status: t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('owner')
  @Get('tenants/:tenantId/users')
  async listTenantUsers(@Param('tenantId') tenantId: string) {
    const items = await this.admin.listUsersByTenant(tenantId);
    return items.map((u: any) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      tenantId: u.tenantId,
      isActive: u.isActive,
    }));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('owner')
  @Post('impersonate')
  async impersonate(@Body() body: { userId: string }, @Req() req: any) {
    const userId = String(body?.userId || '').trim();
    if (!userId) return { message: 'Missing userId' };

    const target = await this.admin.findUserById(userId);
    if (!target) return { message: 'User not found' };

    const token = this.auth.signForUser(target as any);

    return {
      accessToken: token,
      user: {
        id: (target as any).id,
        email: (target as any).email,
        role: (target as any).role,
        tenantId: (target as any).tenantId,
      },
      impersonatedBy: {
        userId: req.user?.userId,
        email: req.user?.email,
      },
    };
  }
}
