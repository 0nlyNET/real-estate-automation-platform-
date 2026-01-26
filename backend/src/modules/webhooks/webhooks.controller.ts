import { Body, Controller, Headers, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
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
    return res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }
}
