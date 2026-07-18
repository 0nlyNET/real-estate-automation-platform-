import { Body, Controller, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PresenceService } from './presence.service';
import { PresenceStatusDto } from './presence.dto';

@UseGuards(JwtAuthGuard)
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Post('heartbeat')
  async heartbeat(@Req() req: any, @Body() body: PresenceStatusDto) {
    return this.presence.heartbeat(
      req.user?.tenantId,
      req.user?.sub,
      body?.status,
    );
  }

  @Put('status')
  async setStatus(@Req() req: any, @Body() body: PresenceStatusDto) {
    return this.presence.setStatus(
      req.user?.tenantId,
      req.user?.sub,
      body?.status,
    );
  }
}
