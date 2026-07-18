import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('twilio/inbound')
  async twilioInbound(
    @Body() body: any,
    @Headers() headers: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    await this.webhooks.handleTwilioInbound(body, headers);

    res.type('text/xml');
    return res.send(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    );
  }

  @Get('facebook/lead-ads')
  facebookVerify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') verifyToken: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ) {
    const verified = this.webhooks.verifyFacebookWebhook(
      mode,
      verifyToken,
      challenge,
    );
    return res.status(200).send(verified);
  }

  @Post('facebook/lead-ads')
  async facebookLeadAds(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: any,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    return this.webhooks.handleFacebookLeadAds(
      body,
      req.rawBody,
      signature || '',
    );
  }
}
