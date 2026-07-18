import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { ImpersonateDto } from './admin.dto';

@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly auth: AuthService,
  ) {}

  @Get('overview')
  async overview() {
    return this.admin.overview();
  }

  @Get('system-health')
  async systemHealth() {
    return this.admin.systemHealth();
  }

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

  @Post('impersonate')
  async impersonate(@Body() body: ImpersonateDto, @Req() req: any) {
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
        userId: req.user?.sub,
        email: req.user?.email,
      },
    };
  }
}
