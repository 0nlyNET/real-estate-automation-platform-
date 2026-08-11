import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  Param,
  Post,
  Get,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateWebhookSubscriptionDto,
  CreateZapierConnectionDto,
  ZapierLeadIngressDto,
} from './crm-integrations.dto';
import { CrmIntegrationsService } from './crm-integrations.service';

@Controller('integrations/crm')
@UseGuards(JwtAuthGuard, RolesGuard)
@RequireRole('admin')
export class CrmIntegrationsController {
  constructor(private readonly crm: CrmIntegrationsService) {}

  @Get('connections/zapier')
  listConnections(@Req() req: any) {
    return this.crm.listConnections(req.user.tenantId);
  }

  @Post('connections/zapier')
  createConnection(@Req() req: any, @Body() body: CreateZapierConnectionDto) {
    return this.crm.createZapierConnection(req.user.tenantId, body.label);
  }

  @Post('connections/zapier/:id/rotate')
  rotateConnection(@Req() req: any, @Param('id') id: string) {
    return this.crm.rotateConnection(req.user.tenantId, id);
  }

  @Post('connections/zapier/:id/test')
  sendTestLead(@Req() req: any, @Param('id') id: string) {
    return this.crm.sendTestLead(req.user.tenantId, id);
  }

  @Delete('connections/zapier/:id')
  revokeConnection(@Req() req: any, @Param('id') id: string) {
    return this.crm.revokeConnection(req.user.tenantId, id);
  }

  @Get('webhooks')
  listWebhooks(@Req() req: any) {
    return this.crm.listWebhooks(req.user.tenantId);
  }

  @Post('webhooks')
  createWebhook(@Req() req: any, @Body() body: CreateWebhookSubscriptionDto) {
    return this.crm.createWebhook(req.user.tenantId, body);
  }

  @Post('webhooks/:id/test')
  testWebhook(@Req() req: any, @Param('id') id: string) {
    return this.crm.testWebhook(req.user.tenantId, id);
  }

  @Delete('webhooks/:id')
  revokeWebhook(@Req() req: any, @Param('id') id: string) {
    return this.crm.revokeWebhook(req.user.tenantId, id);
  }
}

@Controller('integrations/zapier')
export class ZapierIngressController {
  constructor(private readonly crm: CrmIntegrationsService) {}

  @Post('leads')
  @HttpCode(202)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  ingest(
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-realtytechai-event-id') eventId: string | undefined,
    @Headers('x-realtytechai-test-run-id') testRunId: string | undefined,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    body: ZapierLeadIngressDto,
  ) {
    return this.crm.ingestZapierLead({
      authorization,
      headerEventId: eventId,
      testRunId,
      payload: body,
    });
  }
}
