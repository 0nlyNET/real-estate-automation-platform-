import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireTeamsPlan, TeamsPlanGuard } from '../../common/guards/plan.guard';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  // Dashboard-safe overview (any plan)
  @UseGuards(JwtAuthGuard)
  @Get('overview')
  async overview(@Req() req: any) {
    return await this.stats.overview(req.user?.tenantId, {
      userId: req.user?.userId,
      role: req.user?.role,
    });
  }

  // Teams/Brokerages: agent leaderboard & performance
  @UseGuards(JwtAuthGuard, TeamsPlanGuard, RolesGuard)
  @RequireTeamsPlan()
  @RequireRole('admin')
  @Get('agents')
  async agentMetrics(@Req() req: any) {
    return await this.stats.agentMetrics(req.user?.tenantId);
  }
}
