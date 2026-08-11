import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireServiceAccess, ServiceAccessGuard } from '../../common/guards/plan.guard';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  // Dashboard-safe overview (any plan)
  @UseGuards(JwtAuthGuard)
  @Get('overview')
  async overview(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    return await this.stats.overview(req.user?.tenantId, {
      userId: req.user?.sub,
      role: req.user?.role,
    }, { from, to });
  }

  // Managed-service agent leaderboard and performance.
  @UseGuards(JwtAuthGuard, ServiceAccessGuard, RolesGuard)
  @RequireServiceAccess()
  @RequireRole('admin')
  @Get('agents')
  async agentMetrics(@Req() req: any) {
    return await this.stats.agentMetrics(req.user?.tenantId);
  }

  @UseGuards(JwtAuthGuard, ServiceAccessGuard, RolesGuard)
  @RequireServiceAccess()
  @RequireRole('admin')
  @Get('teams')
  teamMetrics(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('teamId') teamId?: string,
    @Query('agentId') agentId?: string,
    @Query('source') source?: string,
  ) {
    return this.stats.teamPerformance(req.user?.tenantId, {
      from,
      to,
      teamId,
      agentId,
      source,
    });
  }
}
