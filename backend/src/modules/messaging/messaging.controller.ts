import { Body, Controller, Post } from '@nestjs/common';
import { MessagingService } from './messaging.service';

@Controller('messaging')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Post('test-email')
  async testEmail(@Body() body: { to: string }) {
    return this.messaging.sendLeadAutoReply({
      leadEmail: body.to,
      leadName: 'Test Lead',
      bookingLink: 'https://example.com',
    });
  }
}

