import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiConfigurationService } from './ai-configuration.service';
import { AiConversationControlService } from './ai-conversation-control.service';
import {
  ConfirmAiActionDto,
  EditAiDraftDto,
  PauseAiDto,
  TakeOverConversationDto,
  UpdateAiSettingsDto,
  UpdateBrokerageKnowledgeDto,
} from './ai.dto';

function actorFrom(req: any) {
  return {
    userId: String(req.user?.sub || ''),
    email: req.user?.email || null,
    role: req.user?.role,
  };
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly configuration: AiConfigurationService,
    private readonly conversations: AiConversationControlService,
  ) {}

  @Get('settings')
  getSettings(@Req() req: any) {
    return this.configuration.getConfiguration(req.user.tenantId);
  }

  @Put('settings')
  @RequireRole('admin')
  updateSettings(@Req() req: any, @Body() body: UpdateAiSettingsDto) {
    return this.configuration.updateSettings(
      req.user.tenantId,
      body,
      actorFrom(req),
    );
  }

  @Post('settings/approve')
  @RequireRole('admin')
  approveSettings(@Req() req: any) {
    return this.configuration.approveSettings(
      req.user.tenantId,
      actorFrom(req),
    );
  }

  @Put('knowledge')
  @RequireRole('admin')
  updateKnowledge(
    @Req() req: any,
    @Body() body: UpdateBrokerageKnowledgeDto,
  ) {
    return this.configuration.updateKnowledge(
      req.user.tenantId,
      body,
      actorFrom(req),
    );
  }

  @Post('knowledge/approve')
  @RequireRole('admin')
  approveKnowledge(@Req() req: any) {
    return this.configuration.approveKnowledge(
      req.user.tenantId,
      actorFrom(req),
    );
  }

  @Post('emergency-pause')
  @RequireRole('admin')
  setWorkspacePause(@Req() req: any, @Body() body: PauseAiDto) {
    return this.conversations.setWorkspacePause(
      req.user.tenantId,
      body.paused,
      body.reason || '',
      actorFrom(req),
    );
  }

  @Get('conversations/:leadId')
  @RequireRole('tc')
  getConversation(@Req() req: any, @Param('leadId') leadId: string) {
    return this.conversations.getConversation(
      req.user.tenantId,
      leadId,
      actorFrom(req),
    );
  }

  @Post('conversations/:leadId/take-over')
  @RequireRole('tc')
  takeOver(
    @Req() req: any,
    @Param('leadId') leadId: string,
    @Body() body: TakeOverConversationDto,
  ) {
    return this.conversations.takeOver(
      req.user.tenantId,
      leadId,
      actorFrom(req),
      body.reason,
    );
  }

  @Post('conversations/:leadId/return-to-ai')
  @RequireRole('tc')
  returnToAi(
    @Req() req: any,
    @Param('leadId') leadId: string,
    @Body() body: ConfirmAiActionDto,
  ) {
    return this.conversations.returnToAi(
      req.user.tenantId,
      leadId,
      actorFrom(req),
      body.confirmed,
    );
  }

  @Post('conversations/:leadId/drafts/:messageId/approve')
  @RequireRole('tc')
  approveDraft(
    @Req() req: any,
    @Param('leadId') leadId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.conversations.approveDraft(
      req.user.tenantId,
      leadId,
      messageId,
      actorFrom(req),
    );
  }

  @Post('conversations/:leadId/drafts/:messageId/edit-and-send')
  @RequireRole('tc')
  editAndSendDraft(
    @Req() req: any,
    @Param('leadId') leadId: string,
    @Param('messageId') messageId: string,
    @Body() body: EditAiDraftDto,
  ) {
    return this.conversations.editAndSendDraft(
      req.user.tenantId,
      leadId,
      messageId,
      body.body,
      actorFrom(req),
    );
  }

  @Post('conversations/:leadId/drafts/:messageId/reject')
  @RequireRole('tc')
  rejectDraft(
    @Req() req: any,
    @Param('leadId') leadId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.conversations.rejectDraft(
      req.user.tenantId,
      leadId,
      messageId,
      actorFrom(req),
    );
  }
}
