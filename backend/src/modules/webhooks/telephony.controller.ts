import { Body, Controller, Headers, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { TwilioInboundBody, WebhooksService } from "./webhooks.service";

const EMPTY_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

@Controller("api/v1/telephony/twilio")
export class TelephonyController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post("sms-callback")
  async smsCallback(
    @Body() body: TwilioInboundBody,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res() response: Response,
  ) {
    await this.webhooks.handleTwilioInbound(body, headers);
    return response.type("text/xml").status(200).send(EMPTY_TWIML);
  }
}
