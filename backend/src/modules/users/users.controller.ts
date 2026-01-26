import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from './users.service';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { RequireTeamsPlan, TeamsPlanGuard } from '../../common/guards/plan.guard';
import { UserRole, canManageUsers } from '../../common/rbac';

function randomTempPassword() {
  // Not meant to be super human-friendly. User can reset later.
  return `Temp-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 6)}`;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly tenants: TenantsService,
  ) {}

  @Get()
  async list(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    // Owners/Admins can see the full roster.
    if (canManageUsers((req.user?.role as UserRole) || 'read_only')) {
      const list = await this.users.listByTenant(tenantId);
      return list.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        teamId: u.teamId,
        isActive: u.isActive,
        isEmailVerified: u.isEmailVerified,
      }));
    }

    // Non-managers only see themselves.
    return [{
      id: req.user?.userId,
      email: req.user?.email,
      role: req.user?.role,
      teamId: null,
      isActive: true,
      isEmailVerified: true,
    }];
  }

  // Create a new team member (Teams plan only)
  @UseGuards(TeamsPlanGuard)
  @RequireTeamsPlan()
  @RequireRole('admin')
  @Post()
  async create(@Req() req: any, @Body() body: any) {
    const tenantId = req.user?.tenantId;
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new BadRequestException('Tenant not found');

    const email = (body?.email || '').toString();
    const role = (body?.role || 'agent') as UserRole;
    const teamId = body?.teamId ? String(body.teamId) : null;

    const tempPassword = body?.tempPassword ? String(body.tempPassword) : randomTempPassword();

    const { user, verifyToken } = await this.users.createTeamUser({
      tenant,
      email,
      tempPassword,
      role,
      teamId,
    });

    const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verifyLink = `${frontend.replace(/\/+$/, '')}/verify-email?token=${verifyToken}`;

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      teamId: user.teamId,
      isActive: user.isActive,
      tempPassword,
      verifyLink,
    };
  }

  @UseGuards(TeamsPlanGuard)
  @RequireTeamsPlan()
  @RequireRole('admin')
  @Patch(':id/role')
  async updateRole(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const tenantId = req.user?.tenantId;
    const role = (body?.role || 'agent') as UserRole;
    return await this.users.updateRole(tenantId, id, role);
  }

  @UseGuards(TeamsPlanGuard)
  @RequireTeamsPlan()
  @RequireRole('admin')
  @Patch(':id/team')
  async updateTeam(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const tenantId = req.user?.tenantId;
    const teamId = body?.teamId ? String(body.teamId) : null;
    return await this.users.updateTeam(tenantId, id, teamId);
  }

  @UseGuards(TeamsPlanGuard)
  @RequireTeamsPlan()
  @RequireRole('admin')
  @Patch(':id/active')
  async setActive(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    const tenantId = req.user?.tenantId;
    const isActive = !!body?.isActive;
    return await this.users.setActive(tenantId, id, isActive);
  }
}
