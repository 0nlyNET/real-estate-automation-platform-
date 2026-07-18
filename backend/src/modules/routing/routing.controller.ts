import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoutingService } from './routing.service';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { RequireTeamsPlan, TeamsPlanGuard } from '../../common/guards/plan.guard';
import { UpsertRoutingRuleDto } from './routing.dto';

@UseGuards(JwtAuthGuard, TeamsPlanGuard, RolesGuard)
@RequireTeamsPlan()
@Controller('routing')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  @Get('rules')
  async list(@Req() req: any) {
    return this.routing.listRules(req.user?.tenantId);
  }

  @Post('rules')
  @RequireRole('admin')
  async upsert(@Req() req: any, @Body() body: UpsertRoutingRuleDto) {
    return this.routing.upsertRule(req.user?.tenantId, body.rule);
  }

  @Delete('rules/:id')
  @RequireRole('admin')
  async del(@Req() req: any, @Param('id') id: string) {
    return this.routing.deleteRule(req.user?.tenantId, id);
  }
}
