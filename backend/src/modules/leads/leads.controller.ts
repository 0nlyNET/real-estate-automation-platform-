import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

import { LeadsService } from './leads.service';
import { IntakeLeadDto } from './dto/intake-lead.dto';

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
    @Query('tenantId') tenantId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.leadsService.listLeads({
      tenantId,
      take: take ? parseInt(take, 10) : 50,
      skip: skip ? parseInt(skip, 10) : 0,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('leads/:id')
  getOne(@Param('id') id: string) {
    return this.leadsService.getLeadById(id);
  }
}

