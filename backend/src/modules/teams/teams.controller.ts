import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { RequireTeamsPlan, TeamsPlanGuard } from '../../common/guards/plan.guard';
import { TeamsService } from './teams.service';
import { TeamNameDto } from './teams.dto';

@UseGuards(JwtAuthGuard, TeamsPlanGuard, RolesGuard)
@RequireTeamsPlan()
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  async list(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    return await this.teams.list(tenantId);
  }

  @RequireRole('admin')
  @Post()
  async create(@Req() req: any, @Body() body: TeamNameDto) {
    const tenantId = req.user?.tenantId;
    return await this.teams.create(tenantId, body?.name);
  }

  @RequireRole('admin')
  @Patch(':teamId')
  async rename(@Req() req: any, @Param('teamId') teamId: string, @Body() body: TeamNameDto) {
    const tenantId = req.user?.tenantId;
    return await this.teams.rename(tenantId, teamId, body?.name);
  }

  @RequireRole('admin')
  @Delete(':teamId')
  async remove(@Req() req: any, @Param('teamId') teamId: string) {
    const tenantId = req.user?.tenantId;
    return await this.teams.remove(tenantId, teamId);
  }
}
