import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Headers,
  UnauthorizedException,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { RequireTeamsPlan, TeamsPlanGuard } from '../../common/guards/plan.guard';

import { LeadsService } from './leads.service';
import { IntakeLeadDto } from './dto/intake-lead.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { Throttle } from '@nestjs/throttler';

@Controller()
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post('leads/intake/:tenantId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  intake(
    @Param('tenantId') tenantId: string,
    @Headers('x-intake-key') intakeKey: string | undefined,
    @Body() payload: IntakeLeadDto,
  ) {
    const secret = String(process.env.PUBLIC_INTAKE_SECRET || '');
    if (!secret || intakeKey !== secret) throw new UnauthorizedException('Invalid intake key');
    return this.leadsService.intake(tenantId, payload);
  }

  @UseGuards(JwtAuthGuard)
  @Get('leads')
  list(
    @Req() req: any,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.leadsService.listLeads({
      tenantId: req.user?.tenantId,
      userId: req.user?.sub,
      role: req.user?.role,
      take: take ? parseInt(take, 10) : 50,
      skip: skip ? parseInt(skip, 10) : 0,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('tc')
  @Post('leads')
  create(@Req() req: any, @Body() payload: CreateLeadDto) {
    return this.leadsService.createLead(req.user?.tenantId, payload, {
      userId: req.user?.sub,
      role: req.user?.role,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  @Post('leads/sample')
  seedSample(@Req() req: any) {
    return this.leadsService.createSampleLeads(req.user?.tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('leads/:id')
  getOne(@Req() req: any, @Param('id') id: string) {
    return this.leadsService.getLeadById(req.user?.tenantId, id, {
      userId: req.user?.sub,
      role: req.user?.role,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('tc')
  @Patch('leads/:id')
  update(@Req() req: any, @Param('id') id: string, @Body() payload: UpdateLeadDto) {
    return this.leadsService.updateLead(req.user?.tenantId, id, payload, {
      userId: req.user?.sub,
      role: req.user?.role,
    });
  }

  @UseGuards(JwtAuthGuard, TeamsPlanGuard, RolesGuard)
  @RequireTeamsPlan()
  @RequireRole('admin')
  @Post('leads/:id/assign')
  assign(@Req() req: any, @Param('id') id: string, @Body() body: AssignLeadDto) {
    return this.leadsService.assignLead({
      tenantId: req.user?.tenantId,
      leadId: id,
      assignedToUserId: body?.assignedToUserId ?? null,
      assignedToTeamId: body?.assignedToTeamId ?? null,
      assignedToLabel: body?.assignedTo ?? null,
    });
  }
}
