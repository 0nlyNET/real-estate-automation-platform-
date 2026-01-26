import { Body, Controller, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PresenceService } from './presence.service';

@UseGuards(JwtAuthGuard)
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Post('heartbeat')
  async heartbeat(@Req() req: any, @Body() body: any) {
    return this.presence.heartbeat(
      req.user?.tenantId,
      req.user?.userId,
      body?.status,
    );
  }

  @Put('status')
  async setStatus(@Req() req: any, @Body() body: any) {
    return this.presence.setStatus(
      req.user?.tenantId,
      req.user?.userId,
      body?.status,
    );
  }
}
