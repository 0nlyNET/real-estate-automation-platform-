import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { RealtorComService } from './realtor-com.service';
import { LeadIngestionService } from '../lead-ingestion/lead-ingestion.service';

@Controller()
export class RealtorComController {
  constructor(
    private readonly realtorCom: RealtorComService,
    private readonly leadIngestion: LeadIngestionService,
  ) {}

  @Get('integrations/realtor-com')
  @UseGuards(JwtAuthGuard)
  getSetup(@Req() req: any) {
    return this.realtorCom.getSetup(req.user?.tenantId);
  }

  @Post('integrations/realtor-com/rotate-key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  rotateKey(@Req() req: any) {
    return this.realtorCom.rotateKey(req.user?.tenantId);
  }

  @Delete('integrations/realtor-com')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  disconnect(@Req() req: any) {
    return this.realtorCom.disconnect(req.user?.tenantId);
  }

  @Post('webhooks/realtor-com/:tenantId')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  receiveLead(
    @Param('tenantId') tenantId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: Record<string, unknown>,
    @Req() req: any,
  ) {
    if (body.test !== true) {
      return this.leadIngestion.ingest({
        body,
        headers: { ...headers, 'x-lead-provider': 'realtor' },
        correlationId:
          req.correlationId || String(req.header('x-request-id') || ''),
      });
    }
    return this.realtorCom.receiveLead(tenantId, headers, body);
  }
}
