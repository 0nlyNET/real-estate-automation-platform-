import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  RegisterPushSubscriptionDto,
  RemovePushSubscriptionDto,
  UpdateNotificationPreferencesDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class ClientNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Req() req: any,
    @Query('unread') unread?: string,
    @Query('read') read?: string,
    @Query('category') category?: string,
    @Query('severity') severity?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.notifications.listForUser(req.user.sub, {
      unread: unread === 'true',
      read: read === 'read' || read === 'unread' ? read : undefined,
      category,
      severity,
      take: Number(take || 30),
      skip: Number(skip || 0),
    });
  }

  @Get('summary')
  summary(@Req() req: any) {
    return this.notifications.summary(req.user.sub);
  }

  @Patch(':id/read')
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.notifications.markRead(req.user.sub, id);
  }

  @Post('read-all')
  markAllRead(@Req() req: any) {
    return this.notifications.markAllRead(req.user.sub);
  }

  @Get('preferences/me')
  preferences(@Req() req: any) {
    return this.notifications.getPreferences(req.user.sub);
  }

  @Patch('preferences/me')
  updatePreferences(
    @Req() req: any,
    @Body() body: UpdateNotificationPreferencesDto,
  ) {
    return this.notifications.updatePreferences(req.user.sub, body);
  }

  @Get('push/config')
  pushConfig() {
    return this.notifications.pushConfig();
  }

  @Post('push/subscriptions')
  subscribe(@Req() req: any, @Body() body: RegisterPushSubscriptionDto) {
    return this.notifications.registerSubscription(req.user.sub, {
      ...body,
      userAgent: String(req.headers?.['user-agent'] || ''),
    });
  }

  @Delete('push/subscriptions')
  unsubscribe(@Req() req: any, @Body() body: RemovePushSubscriptionDto) {
    return this.notifications.removeSubscription(req.user.sub, body.endpoint);
  }
}
