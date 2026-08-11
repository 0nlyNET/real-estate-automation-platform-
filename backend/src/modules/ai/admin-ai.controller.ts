import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PlatformOperatorGuard } from '../../common/guards/platform-operator.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiConversationControlService } from './ai-conversation-control.service';
import { PauseAiDto } from './ai.dto';
import { AiSetupService } from './ai-setup.service';

@UseGuards(JwtAuthGuard, PlatformOperatorGuard)
@Controller('admin/ai')
export class AdminAiController {
  constructor(
    private readonly conversations: AiConversationControlService,
    private readonly setup: AiSetupService,
  ) {}

  @Get('overview')
  overview() {
    return this.conversations.platformOverview();
  }

  @Get('provider-test')
  providerTestStatus() {
    return this.setup.status();
  }

  @Post('provider-test')
  @UseGuards(PlatformAdminGuard)
  testProvider(@Req() req: any) {
    return this.setup.test({
      id: String(req.user?.sub || ''),
      tenantId: String(req.user?.tenantId || ''),
      email: req.user?.email || null,
    });
  }

  @Post('emergency-pause')
  @UseGuards(PlatformAdminGuard)
  setPlatformPause(@Req() req: any, @Body() body: PauseAiDto) {
    return this.conversations.setPlatformPause(
      body.paused,
      body.reason || '',
      {
        id: String(req.user?.sub || ''),
        email: req.user?.email || null,
      },
    );
  }
}
