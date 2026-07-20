import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SupportService } from './support.service';
import { AccountRequestDto, CreateSupportTicketDto, UpdateSupportTicketDto } from './support.dto';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { PlatformOperatorGuard } from '../../common/guards/platform-operator.guard';

@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @UseGuards(JwtAuthGuard, PlatformOperatorGuard)
  @Get('admin/tickets')
  listTickets(@Query('status') status?: any) {
    return this.support.listTickets(status);
  }

  @UseGuards(JwtAuthGuard, PlatformOperatorGuard)
  @Patch('admin/tickets/:id')
  updateTicket(@Param('id') id: string, @Body() body: UpdateSupportTicketDto) {
    return this.support.updateTicket(id, body);
  }

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

    return await this.support.createTicket({
      tenantId,
      userId,
      email,
      name,
      subject,
      message,
      severity: body.severity,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  @Post('cancellation-request')
  cancellation(@Req() req: any, @Body() body: AccountRequestDto) {
    return this.support.createAccountRequest({
      tenantId: req.user.tenantId,
      userId: req.user.sub,
      email: req.user.email,
      kind: 'cancellation',
      requestedEffectiveDate: body.requestedEffectiveDate,
      note: body.note,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  @Post('deletion-request')
  deletion(@Req() req: any, @Body() body: AccountRequestDto) {
    return this.support.createAccountRequest({
      tenantId: req.user.tenantId,
      userId: req.user.sub,
      email: req.user.email,
      kind: 'deletion',
      requestedEffectiveDate: body.requestedEffectiveDate,
      note: body.note,
    });
  }
}
