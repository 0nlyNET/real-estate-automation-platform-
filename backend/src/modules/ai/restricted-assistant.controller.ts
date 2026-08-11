import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import { PlatformOperatorGuard } from '../../common/guards/platform-operator.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AskRestrictedAssistantDto } from './restricted-assistant.dto';
import { RestrictedAssistantService } from './restricted-assistant.service';

function actor(req: any) {
  return {
    id: String(req.user?.sub || ''),
    tenantId: String(req.user?.tenantId || ''),
    email: req.user?.email || null,
    role: req.user?.role,
  };
}

@UseGuards(JwtAuthGuard)
@Controller('ai/client-assistant')
export class ClientAssistantController {
  constructor(private readonly assistant: RestrictedAssistantService) {}

  @Post()
  ask(@Req() req: any, @Body() body: AskRestrictedAssistantDto) {
    return this.assistant.askClient(actor(req), body.prompt);
  }

  @Post(':runId/confirm')
  confirm(@Req() req: any, @Param('runId') runId: string) {
    return this.assistant.confirmClient(actor(req), runId);
  }
}

@UseGuards(JwtAuthGuard, PlatformOperatorGuard)
@Controller('admin/ai/operations-assistant')
export class OperationsAssistantController {
  constructor(private readonly assistant: RestrictedAssistantService) {}

  @Post()
  ask(@Req() req: any, @Body() body: AskRestrictedAssistantDto) {
    return this.assistant.askOperations(actor(req), body.prompt);
  }

  @Post(':runId/confirm')
  @UseGuards(PlatformAdminGuard)
  confirm(@Req() req: any, @Param('runId') runId: string) {
    return this.assistant.confirmOperations(actor(req), runId);
  }
}
