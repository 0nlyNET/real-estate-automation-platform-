import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoutingService } from './routing.service';

@UseGuards(JwtAuthGuard)
@Controller('routing')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  @Get('rules')
  async list(@Req() req: any) {
    return this.routing.listRules(req.user?.tenantId);
  }

  @Post('rules')
  async upsert(@Req() req: any, @Body() body: any) {
    return this.routing.upsertRule(req.user?.tenantId, body?.rule);
  }

  @Delete('rules')
  async del(@Req() req: any, @Body() body: any) {
    return this.routing.deleteRule(req.user?.tenantId, body?.id);
  }
}
