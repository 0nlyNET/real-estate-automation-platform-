import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MessagingService } from './messaging.service';
import { InboxSendService } from './inbox-send.service';
import { ComplianceService } from '../compliance/compliance.service';
import { Lead } from '../leads/lead.entity';
import { UserRole } from '../../common/rbac';

@UseGuards(JwtAuthGuard)
@Controller('messaging')
export class MessagingController {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly inboxSendService: InboxSendService,
    private readonly complianceService: ComplianceService,
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
  ) {}

  @Get('threads')
  async listThreads(
    @Req() req: any,
    @Query('scope') scope?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('Missing tenant');

    return this.messagingService.listThreads(
      tenantId,
      take ? parseInt(take, 10) : 50,
      skip ? parseInt(skip, 10) : 0,
      {
        userId: req.user?.userId,
        role: req.user?.role as UserRole,
        scope: scope === 'shared' ? 'shared' : 'mine',
      },
    );
  }

  @Get('threads/:leadId')
  async getThreadMessages(@Req() req: any, @Param('leadId') leadId: string) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('Missing tenant');
    if (!leadId?.trim()) throw new BadRequestException('leadId is required');

    return this.messagingService.getThreadMessages(tenantId, leadId.trim());
  }

  @Post('send')
  async send(@Req() req: any, @Body() body: { leadId?: string; body?: string }) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('Missing tenant');

    const leadId = body?.leadId?.trim();
    const messageBody = body?.body?.trim();

    if (!leadId) throw new BadRequestException('leadId is required');
    if (!messageBody) throw new BadRequestException('body is required');
    if (messageBody.length > 1600) throw new BadRequestException('body exceeds 1600 characters');

    const lead = await this.leadRepository.findOne({ where: { id: leadId, tenantId } });
    if (!lead) throw new ForbiddenException('Lead not found');

    if (lead.phone) {
      const optedOut = await this.complianceService.isOptedOut(tenantId, 'sms', lead.phone);
      if (optedOut) throw new ConflictException('Recipient has opted out of SMS');
    }

    return this.inboxSendService.sendSmsToLead(tenantId, leadId, messageBody);
  }

  @Get('messages')
  async getMessages(@Query("scope") scope?: string, @Req() req?: any) {
    const normalizedScope: "mine" | "shared" | undefined =
      scope === "shared" ? "shared" : "mine";

    return {
      ok: true,
      scope: normalizedScope,
      user: req?.user ?? null,
      items: [],
    };
  }

  @Post("manual")
  async sendManual(@Body() body: any, @Req() req?: any) {
    return {
      ok: true,
      user: req?.user ?? null,
      received: body ?? null,
      queued: false,
      note: "Manual send is temporarily stubbed to unblock build",
    };
  }
}
