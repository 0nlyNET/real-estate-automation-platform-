import { Body, Controller, Get, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ComplianceService } from './compliance.service';
import { AddOptOutDto, QuietHoursDto } from './compliance.dto';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';

@UseGuards(JwtAuthGuard)
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  @Post('optout')
  @UseGuards(RolesGuard)
  @RequireRole('admin')
  async optout(@Req() req: any, @Body() body: AddOptOutDto) {
    return this.compliance.addOptOut(
      req.user?.tenantId,
      body?.channel,
      body?.value,
      body?.reason,
      body?.source,
    );
  }

  @Get('quiet-hours')
  async getQh(@Req() req: any) {
    return this.compliance.getQuietHours(req.user?.tenantId);
  }

  @Put('quiet-hours')
  @UseGuards(RolesGuard)
  @RequireRole('admin')
  async putQh(@Req() req: any, @Body() body: QuietHoursDto) {
    return this.compliance.upsertQuietHours(req.user?.tenantId, body);
  }

  @Get('events')
  async events(@Req() req: any, @Query('take') take?: string, @Query('skip') skip?: string) {
    const takeNum = Math.min(Math.max(parseInt(take || '50', 10) || 50, 1), 200);
    const skipNum = Math.max(parseInt(skip || '0', 10) || 0, 0);
    return this.compliance.listEvents(req.user?.tenantId, takeNum, skipNum);
  }

}
