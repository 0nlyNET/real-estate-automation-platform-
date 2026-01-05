import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

import { LeadsService } from './leads.service';
import { IntakeLeadDto } from './dto/intake-lead.dto';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';

@Controller()
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  // PUBLIC: intake endpoint for websites/zapier
  @Post('leads/intake/:tenantId')
  intake(@Param('tenantId') tenantId: string, @Body() payload: IntakeLeadDto) {
    return this.leadsService.intake(tenantId, payload);
  }

  // PROTECTED: agent dashboard endpoints
  @UseGuards(JwtAuthGuard)
  @Get('leads')
  list(
    @Req() req: any,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.leadsService.listLeads({
      tenantId: req.user?.tenantId,
      take: take ? parseInt(take, 10) : 50,
      skip: skip ? parseInt(skip, 10) : 0,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('leads')
  create(@Req() req: any, @Body() payload: CreateLeadDto) {
    return this.leadsService.createLead(req.user?.tenantId, payload);
  }

  @UseGuards(JwtAuthGuard)
  @Post('leads/sample')
  seedSample(@Req() req: any) {
    return this.leadsService.createSampleLeads(req.user?.tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('leads/:id')
  getOne(@Req() req: any, @Param('id') id: string) {
    return this.leadsService.getLeadById(req.user?.tenantId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('leads/:id')
  update(@Req() req: any, @Param('id') id: string, @Body() payload: UpdateLeadDto) {
    return this.leadsService.updateLead(req.user?.tenantId, id, payload);
  }
}

