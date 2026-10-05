import { Controller, Post, Delete, Get, Body, Param, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { OperatorTestAdminService } from './operator-test-admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformOperatorGuard } from '../../common/guards/platform-operator.guard';

/**
 * Operator-restricted grant management endpoints.
 * 
 * - POST /admin/operator-test/grants — create grant (super_admin only)
 * - DELETE /admin/operator-test/grants/:id — revoke grant (super_admin only)
 * - GET /admin/operator-test/grants/:tenantId — list grants (super_admin only)
 * 
 * All actions are audited via service logs.
 */
@Controller('admin/operator-test/grants')
@UseGuards(JwtAuthGuard, PlatformOperatorGuard)
export class OperatorTestAdminController {
  constructor(private readonly adminService: OperatorTestAdminService) {}

  private requireSuperAdmin(req: any) {
    if (req.user?.platformRole !== 'super_admin' || req.user?.impersonatedBy) {
      throw new ForbiddenException('Unimpersonated platform super administrator required');
    }
  }

  @Post()
  async createGrant(
    @Body() body: {
      tenantId: string;
      recipientAllowlist: string[];
      expiresAt: string;
      dailyLimit?: number;
      totalLimit?: number;
      purpose?: string;
    },
    @Req() req: any,
  ) {
    this.requireSuperAdmin(req);
    return this.adminService.createGrant({
      tenantId: body.tenantId,
      recipientAllowlist: body.recipientAllowlist,
      expiresAt: new Date(body.expiresAt),
      dailyLimit: body.dailyLimit,
      totalLimit: body.totalLimit,
      createdBy: req.user?.sub || req.user?.id || '',
      purpose: body.purpose,
    });
  }

  @Delete(':id')
  async revokeGrant(@Param('id') id: string, @Req() req: any) {
    this.requireSuperAdmin(req);
    await this.adminService.revokeGrant(id, req.user?.sub || req.user?.id || '');
    return { revoked: true, grantId: id };
  }

  @Get(':tenantId')
  async listGrants(@Param('tenantId') tenantId: string, @Req() req: any) {
    this.requireSuperAdmin(req);
    return this.adminService.listGrants(tenantId);
  }
}
