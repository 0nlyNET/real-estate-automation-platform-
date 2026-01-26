import { Body, Controller, Get, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { IntegrationsService } from './integrations.service';
import { UpsertSendGridDto, UpsertTwilioDto } from './integrations.dto';

@Controller('integrations')
@UseGuards(JwtAuthGuard)
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  async list(@Req() req: any) {
    return this.integrationsService.list(req.user?.tenantId);
  }

  @Put('twilio')
  async connectTwilio(@Req() req: any, @Body() dto: UpsertTwilioDto) {
    // your service does NOT have saveTwilio; it has connectTwilio
    return this.integrationsService.connectTwilio(req.user?.tenantId, dto as any);
  }

  @Post('twilio/test')
  async testTwilio(
    @Req() req: any,
    @Body() dto: { toNumber?: string; message?: string } = {},
  ) {
    // your service signature requires dto
    return this.integrationsService.testTwilio(req.user?.tenantId, dto);
  }

  @Put('sendgrid')
  async connectSendGrid(@Req() req: any, @Body() dto: UpsertSendGridDto) {
    // your service does NOT have saveSendGrid; it has connectSendGrid
    return this.integrationsService.connectSendGrid(req.user?.tenantId, dto as any);
  }

  @Post('sendgrid/test')
  async testSendGrid(@Req() req: any, @Body() dto: { toEmail?: string } = {}) {
    // your service signature requires dto
    return this.integrationsService.testSendGrid(req.user?.tenantId, dto);
  }

  /**
   * Facebook Lead Ads OAuth: return the URL the frontend should redirect the user to.
   * We keep this simple and stable:
   * - state = tenantId
   * - redirect_uri = {backend}/integrations/facebook/callback
   */
  @Get('facebook/connect')
  async facebookConnect(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    const appId = process.env.FACEBOOK_APP_ID;

    if (!tenantId) return { ok: false, error: 'Missing tenantId on JWT' };
    if (!appId) return { ok: false, error: 'FACEBOOK_APP_ID is missing in backend/.env' };

    const proto = (req as Request).headers['x-forwarded-proto']
      ? String((req as Request).headers['x-forwarded-proto'])
      : (req as Request).protocol;

    const host = (req as Request).headers['x-forwarded-host']
      ? String((req as Request).headers['x-forwarded-host'])
      : (req as Request).get('host');

    const base = `${proto}://${host}`;
    const redirectUri = `${base}/integrations/facebook/callback`;

    // permissions for leadgen
    const scope = [
      'pages_show_list',
      'pages_read_engagement',
      'leads_retrieval',
      'pages_manage_metadata',
    ].join(',');

    const url =
      'https://www.facebook.com/v19.0/dialog/oauth' +
      `?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(String(tenantId))}` +
      `&scope=${encodeURIComponent(scope)}`;

    return { ok: true, url, redirectUri };
  }

  /**
   * Facebook OAuth callback:
   * - code + state come from Facebook
   * - your service already has facebookOAuthCallback(code, state)
   * - redirect back to frontend integrations page with a result flag
   */
  @Get('facebook/callback')
  async facebookCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';

    if (error) {
      const msg = errorDescription ? String(errorDescription) : String(error);
      return res.redirect(`${frontend}/app/integrations?facebook=error&message=${encodeURIComponent(msg)}`);
    }

    if (!code || !state) {
      return res.redirect(`${frontend}/app/integrations?facebook=error&message=${encodeURIComponent('Missing code/state')}`);
    }

    const result = await this.integrationsService.facebookOAuthCallback(String(code), String(state));

    if (result?.ok) {
      return res.redirect(`${frontend}/app/integrations?facebook=success`);
    }

    const msg = result?.error ? String(result.error) : 'Facebook connect failed';
    return res.redirect(`${frontend}/app/integrations?facebook=error&message=${encodeURIComponent(msg)}`);
  }
}
