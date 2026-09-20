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
import { RolesGuard, RequireRole } from '../../common/guards/roles.guard';
import { MarkConversationReadDto, SendBookingLinkDto, SendMessageDto } from './messaging.dto';
import { ConversationInboxService } from './conversation-inbox.service';
import { SettingsService } from '../settings/settings.service';
import { isSafeBookingUrl } from '../../common/booking-link';

@UseGuards(JwtAuthGuard)
@Controller('messaging')
export class MessagingController {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly inboxSendService: InboxSendService,
    private readonly complianceService: ComplianceService,
    private readonly settingsService: SettingsService,
    @InjectRepository(Lead)
    private readonly leadRepository: Repository<Lead>,
    private readonly conversationInbox: ConversationInboxService,
  ) {}

  @Get('threads')
  async listThreads(
    @Req() req: any,
    @Query('scope') scope?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Query('includeMeta') includeMeta?: string,
  ) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('Missing tenant');

    const page = await this.messagingService.listThreads(
      tenantId,
      parsePageInteger(take, 'take', 50, 1, 200),
      parsePageInteger(skip, 'skip', 0, 0, 100_000),
      {
        userId: req.user?.sub,
        role: req.user?.role as UserRole,
        scope: scope === 'mine' ? 'mine' : 'shared',
      },
      includeMeta === '1' || includeMeta === 'true',
    );
    const items = Array.isArray(page) ? page : page.items;
    const leadIds = items.flatMap((item) => item.leadId ? [item.leadId] : []);
    const [reads, ai] = await Promise.all([
      this.conversationInbox.readStates(tenantId, req.user?.sub, leadIds),
      this.conversationInbox.aiSummaries(tenantId, items.flatMap((item) =>
        item.leadId ? [{ leadId: item.leadId, channel: item.channel }] : [])),
    ]);
    const enriched = items.map((item) => ({ ...item,
      ...reads.find((row) => row.leadId === item.leadId),
      ...ai.get(item.leadId!),
    }));
    return Array.isArray(page) ? enriched : { ...page, items: enriched };
  }

  @Get('threads/:leadId')
  async getThreadMessages(
    @Req() req: any,
    @Param('leadId') leadId: string,
    @Query('take') take?: string,
    @Query('before') before?: string,
    @Query('changedAfter') changedAfter?: string,
    @Query('includeMeta') includeMeta?: string,
  ) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('Missing tenant');
    if (!leadId?.trim()) throw new BadRequestException('leadId is required');

    const page = await this.messagingService.getThreadMessages(
      tenantId,
      leadId.trim(),
      {
        userId: req.user?.sub,
        role: req.user?.role as UserRole,
      },
      {
        includeMeta: includeMeta === '1' || includeMeta === 'true',
        take: parsePageInteger(take, 'take', 50, 1, 200),
        before: before?.trim() || undefined,
        changedAfter: changedAfter?.trim() || undefined,
      },
    );
    if (Array.isArray(page)) return page;
    const [readState] = await this.conversationInbox.readStates(tenantId, req.user?.sub, [leadId.trim()]);
    return { ...page, readState };
  }

  @Post('threads/:leadId/read')
  async markRead(@Req() req: any, @Param('leadId') leadId: string, @Body() body: MarkConversationReadDto) {
    return this.conversationInbox.markRead(req.user?.tenantId, req.user?.sub, leadId, body?.messageId, body?.unreadVersion);
  }

  @Post('threads/:leadId/unread')
  async markUnread(@Req() req: any, @Param('leadId') leadId: string) {
    return this.conversationInbox.markUnread(req.user?.tenantId, req.user?.sub, leadId);
  }

  @Post('send')
  @UseGuards(RolesGuard)
  @RequireRole('tc')
  async send(@Req() req: any, @Body() body: SendMessageDto) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('Missing tenant');

    const leadId = body?.leadId?.trim();
    const messageBody = body?.body?.trim();

    if (!leadId) throw new BadRequestException('leadId is required');
    if (!messageBody) throw new BadRequestException('body is required');
    if (messageBody.length > 1600) throw new BadRequestException('body exceeds 1600 characters');

    const lead = await this.leadRepository.findOne({ where: { id: leadId, tenantId } });
    if (!lead) throw new ForbiddenException('Lead not found');
    const role = req.user?.role as UserRole;
    if (!['owner', 'admin'].includes(role) && lead.assignedToUserId !== req.user?.sub) {
      throw new ForbiddenException('Lead is not assigned to this user');
    }

    const channel = body.channel || (lead.email ? 'email' : 'sms');
    const recipient = channel === 'sms' ? lead.phone : lead.email;
    if (!recipient) {
      throw new ConflictException(
        channel === 'sms'
          ? 'Lead does not have a phone number'
          : 'Lead does not have an email address',
      );
    }
    const optedOut = await this.complianceService.isOptedOut(
      tenantId,
      channel,
      recipient,
    );
    if (optedOut) {
      throw new ConflictException(
        channel === 'sms'
          ? 'Recipient has opted out of SMS'
          : 'Recipient has unsubscribed from email',
      );
    }

    const actor = {
      userId: req.user?.sub,
      email: req.user?.email,
      role,
    };
    return channel === 'email'
      ? this.inboxSendService.queueEmailToLead(
          tenantId,
          leadId,
          messageBody,
          actor,
          body.requestId,
        )
      : this.inboxSendService.sendSmsToLead(
          tenantId,
          leadId,
          messageBody,
          actor,
          body.requestId,
        );
  }

  @Post('send-booking-link')
  @UseGuards(RolesGuard)
  @RequireRole('tc')
  async sendBookingLink(@Req() req: any, @Body() body: SendBookingLinkDto) {
    const tenantId = req.user?.tenantId;
    const lead = await this.leadRepository.findOne({ where: { id: body.leadId, tenantId } });
    if (!lead) throw new ForbiddenException('Lead not found');
    if (!lead.phone && !lead.email) throw new BadRequestException('Add an email address or phone number before sending the booking link');
    const role = req.user?.role as UserRole;
    if (!['owner', 'admin'].includes(role) && lead.assignedToUserId !== req.user?.sub) throw new ForbiddenException('Lead is not assigned to this user');
    const settings = await this.settingsService.getTenantSettings(tenantId);
    if (!settings || !isSafeBookingUrl(settings.bookingLink) || !settings.bookingLinkVerifiedAt) throw new ConflictException('Test and confirm the workspace booking link before sending it');
    return this.inboxSendService[lead.email ? 'queueEmailToLead' : 'sendSmsToLead'](
      tenantId,
      lead.id,
      `Choose a convenient appointment time here: ${settings.bookingLink}`,
      {
        userId: req.user?.sub,
        email: req.user?.email,
        role,
      },
    );
  }
}

function parsePageInteger(
  raw: string | undefined,
  field: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new BadRequestException(`${field} must be an integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new BadRequestException(
      `${field} must be between ${minimum} and ${maximum}`,
    );
  }
  return value;
}
