import { Controller, Get, Post, Param, Req, UseGuards, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AgencyAdminGuard } from '../auth/agency-admin.guard';
import { AgencyService } from './agency.service';
import { JwtService } from '@nestjs/jwt';
import { TenantsService } from '../tenants/tenants.service';

@Controller('agency')
@UseGuards(JwtAuthGuard, AgencyAdminGuard)
export class AgencyController {
  constructor(
    private readonly agency: AgencyService,
    private readonly tenants: TenantsService,
    private readonly jwt: JwtService,
  ) {}

  @Get('health')
  health() {
    return { ok: true };
  }

  @Get('tenants')
  async tenantsList() {
    return this.agency.listTenants();
  }

  @Get('tenants/:tenantId')
  async tenantDetail(@Param('tenantId') tenantId: string) {
    const tenant = await this.agency.getTenantDetail(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  @Get('tenants/:tenantId/health')
  async tenantHealth(@Param('tenantId') tenantId: string) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');
    return this.agency.getHealth(tenant);
  }

  @Post('impersonate/:tenantId')
  async impersonate(@Param('tenantId') tenantId: string, @Req() req: any) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant not found');

    const accessToken = await this.jwt.signAsync({
      sub: req.user?.userId,
      tenantId: tenant.id,
      email: req.user?.email,
      role: 'AGENCY_ADMIN',
      impersonatorId: req.user?.userId,
    });

    return { accessToken };
  }
}
