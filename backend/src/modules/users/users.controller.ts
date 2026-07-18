import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from './users.service';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { RequireTeamsPlan, TeamsPlanGuard } from '../../common/guards/plan.guard';
import { UserRole, canManageUsers } from '../../common/rbac';
import { CreateTeamUserDto, UpdateUserActiveDto, UpdateUserRoleDto, UpdateUserTeamDto } from './users.dto';
import * as crypto from 'crypto';

function randomTempPassword() {
  return `Temp-${crypto.randomBytes(18).toString('base64url')}`;
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

    return [{
      id: req.user?.sub || null,
      email: req.user?.email || null,
      role: req.user?.role || null,
      teamId: null,
      isActive: true,
      isEmailVerified: true,
    }];
  }

  @UseGuards(TeamsPlanGuard)
  @RequireTeamsPlan()
  @RequireRole('admin')
  @Post()
  async create(@Req() req: any, @Body() body: CreateTeamUserDto) {
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
  async updateRole(@Req() req: any, @Param('id') id: string, @Body() body: UpdateUserRoleDto) {
    const tenantId = req.user?.tenantId;
    const role = (body?.role || 'agent') as UserRole;
    return this.users.updateRole(tenantId, id, role, { userId: req.user?.sub, role: req.user?.role });
  }

  @UseGuards(TeamsPlanGuard)
  @RequireTeamsPlan()
  @RequireRole('admin')
  @Patch(':id/team')
  async updateTeam(@Req() req: any, @Param('id') id: string, @Body() body: UpdateUserTeamDto) {
    const tenantId = req.user?.tenantId;
    const teamId = body?.teamId ? String(body.teamId) : null;
    return this.users.updateTeam(tenantId, id, teamId, { userId: req.user?.sub, role: req.user?.role });
  }

  @UseGuards(TeamsPlanGuard)
  @RequireTeamsPlan()
  @RequireRole('admin')
  @Patch(':id/active')
  async setActive(@Req() req: any, @Param('id') id: string, @Body() body: UpdateUserActiveDto) {
    const tenantId = req.user?.tenantId;
    const isActive = !!body?.isActive;
    return this.users.setActive(tenantId, id, isActive, { userId: req.user?.sub, role: req.user?.role });
  }
}
