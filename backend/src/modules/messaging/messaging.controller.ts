import { Body, Controller, Post } from '@nestjs/common';
import { MessagingService } from './messaging.service';

type TestEmailDto = {
  to: string;
};

// Twilio sends application/x-www-form-urlencoded with fields like:
// From=+1555...&To=+1...&Body=...
// Depending on your Nest body parser config, this will arrive as a plain object.
type TwilioInboundSmsBody = {
  From?: string;
  To?: string;
  Body?: string;

  // sometimes people proxy/transform fields to lowercase
  from?: string;
  to?: string;
  body?: string;
  text?: string;
};

type SendgridInboundBody = {
  from?: string;
  text?: string;
  subject?: string;
};

@Controller('messaging')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Post('test-email')
  async testEmail(@Body() body: TestEmailDto) {
    return this.messaging.sendLeadAutoReply({
      leadEmail: body?.to,
      leadName: 'Test Lead',
      bookingLink: 'https://example.com',
    });
  }

  @Post('webhooks/twilio/sms')
  async twilioSmsWebhook(@Body() body: TwilioInboundSmsBody) {
    // Be defensive about field casing so local tests/proxies don’t break it
    const From = body?.From ?? body?.from;
    const To = body?.To ?? body?.to;
    const Body = body?.Body ?? body?.body ?? body?.text;

    return this.messaging.handleInboundSms({ From, To, Body });
  }

  @Post('webhooks/sendgrid/inbound')
  async sendgridInboundWebhook(@Body() body: SendgridInboundBody) {
    // Minimal shape for local testing: { from, text, subject }
    return this.messaging.handleInboundEmail({
      from: body?.from,
      text: body?.text,
      subject: body?.subject,
    });
  }

  @Post('process')
  async processPending() {
    await this.messaging.processPendingOutbound({ limit: 50 });
    return { status: 'ok' };
  }
}