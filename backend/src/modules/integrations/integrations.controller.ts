import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IntegrationsService } from './integrations.service';

@UseGuards(JwtAuthGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  private tenantId(req: any): string {
    return req?.user?.tenantId;
  }

  @Post('zapier/key')
  async createZapierKey(@Req() req: any) {
    const tenantId = this.tenantId(req);
    const out = await this.integrations.generateZapierKey(tenantId);
    return { apiKey: out.apiKey, last4: out.last4 };
  }

  @Get('zapier/key')
  async getZapierKeyMeta(@Req() req: any) {
    const tenantId = this.tenantId(req);
    return this.integrations.getZapierKeyMeta(tenantId);
  }

  @Put('webhooks')
  async setWebhooks(@Req() req: any, @Body() body: any) {
    const tenantId = this.tenantId(req);
    return this.integrations.setWebhooks(tenantId, { url: body.url, events: body.events });
  }

  @Post('webhooks/test')
  async testWebhook(@Req() req: any) {
    const tenantId = this.tenantId(req);
    return this.integrations.testWebhook(tenantId);
  }

  // Facebook Lead Ads stubs (Phase 1)
  @Post('facebook/connect')
  async connectFacebook(@Req() req: any) {
    const tenantId = this.tenantId(req);
    return this.integrations.connectFacebookStub(tenantId);
  }

  @Get('facebook/forms')
  async listForms(@Req() req: any) {
    const tenantId = this.tenantId(req);
    return this.integrations.listFacebookFormsStub(tenantId);
  }

  @Post('facebook/select-form')
  async selectForm(@Req() req: any, @Body() body: any) {
    const tenantId = this.tenantId(req);
    return this.integrations.selectFacebookFormStub(tenantId, body.formId);
  }
}
