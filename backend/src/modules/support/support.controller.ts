import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SupportService } from './support.service';
import { CreateSupportTicketDto } from './support.dto';

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @UseGuards(JwtAuthGuard)
  @Post('contact')
  async contact(
    @Req() req: any,
    @Body() body: CreateSupportTicketDto,
  ) {
    const tenantId = req.user?.tenantId;
    const userId = req.user?.sub;
    const email = String(req.user?.email || '').trim().toLowerCase();
    const subject = (body.subject || '').toString().trim();
    const message = (body.message || '').toString().trim();
    const name = body.name ? String(body.name).trim() : null;

    if (!tenantId || !userId) return { ok: false };
    if (!email || !subject || !message) return { ok: false, message: 'Missing required fields' };

    return await this.support.createTicket({ tenantId, userId, email, name, subject, message });
  }
}
