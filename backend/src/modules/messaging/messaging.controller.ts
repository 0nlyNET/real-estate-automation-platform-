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
import { SendBookingLinkDto, SendMessageDto } from './messaging.dto';
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
        userId: req.user?.sub,
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

    return this.messagingService.getThreadMessages(tenantId, leadId.trim(), {
      userId: req.user?.sub,
      role: req.user?.role as UserRole,
    });
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

    const channel = body.channel || (lead.phone ? 'sms' : 'email');
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
        )
      : this.inboxSendService.sendSmsToLead(
          tenantId,
          leadId,
          messageBody,
          actor,
        );
  }

  @Post('send-booking-link')
  @UseGuards(RolesGuard)
  @RequireRole('tc')
  async sendBookingLink(@Req() req: any, @Body() body: SendBookingLinkDto) {
    const tenantId = req.user?.tenantId;
    const lead = await this.leadRepository.findOne({ where: { id: body.leadId, tenantId } });
    if (!lead) throw new ForbiddenException('Lead not found');
    if (!lead.phone) throw new BadRequestException('Add a phone number before sending the booking link');
    const role = req.user?.role as UserRole;
    if (!['owner', 'admin'].includes(role) && lead.assignedToUserId !== req.user?.sub) throw new ForbiddenException('Lead is not assigned to this user');
    const settings = await this.settingsService.getTenantSettings(tenantId);
    if (!settings || !isSafeBookingUrl(settings.bookingLink) || !settings.bookingLinkVerifiedAt) throw new ConflictException('Test and confirm the workspace booking link before sending it');
    return this.inboxSendService.sendSmsToLead(
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
