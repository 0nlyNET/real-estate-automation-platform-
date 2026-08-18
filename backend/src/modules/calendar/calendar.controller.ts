import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CalendarService } from './calendar.service';
import { CheckAvailabilityDto, SelectCalendarDto } from './calendar.dto';

@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(@Req() req: any) {
    return this.calendar.status(req.user?.tenantId);
  }

  @Post('google/oauth/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  start(@Req() req: any) {
    return this.calendar.startGoogleOAuth(req.user?.tenantId, req.user?.sub);
  }

  @Get('google/oauth/callback')
  async callback(
    @Res() response: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const frontend = String(
      process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'http://localhost:3000',
    ).replace(/\/+$/, '');
    if (error || !code || !state) {
      return response.redirect(`${frontend}/app/integrations?calendar=error&code=OAUTH_DENIED`);
    }
    try {
      await this.calendar.completeGoogleOAuth(code, state);
      return response.redirect(`${frontend}/app/integrations?calendar=choose`);
    } catch (cause: any) {
      const codeValue = String(
        cause?.response?.code || cause?.code || 'OAUTH_FAILED',
      ).replace(/[^A-Z0-9_]/gi, '');
      return response.redirect(
        `${frontend}/app/integrations?calendar=error&code=${encodeURIComponent(codeValue)}`,
      );
    }
  }

  @Get('google/calendars')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  list(@Req() req: any) {
    return this.calendar.listCalendars(req.user?.tenantId);
  }

  @Put('google/selection')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  select(@Req() req: any, @Body() body: SelectCalendarDto) {
    return this.calendar.selectCalendar(
      req.user?.tenantId,
      body.calendarId,
      req.user?.sub,
    );
  }

  @Post('google/test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  test(@Req() req: any) {
    return this.calendar.testConnection(req.user?.tenantId, req.user?.sub);
  }

  @Post('availability')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  availability(@Req() req: any, @Body() body: CheckAvailabilityDto) {
    return this.calendar.checkAvailability(
      req.user?.tenantId,
      new Date(body.startsAt),
      new Date(body.endsAt),
    );
  }

  @Delete('google')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  disconnect(@Req() req: any) {
    return this.calendar.disconnect(req.user?.tenantId, req.user?.sub);
  }

  @Post('google/notifications')
  @HttpCode(204)
  async googleNotifications(@Headers() headers: Record<string, string | string[] | undefined>) {
    const header = (name: string) => {
      const value = headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    await this.calendar.handleGoogleChangeNotification({
      channelId: header('x-goog-channel-id'),
      channelToken: header('x-goog-channel-token'),
      resourceId: header('x-goog-resource-id'),
      resourceState: header('x-goog-resource-state'),
      messageNumber: header('x-goog-message-number'),
      channelExpiration: header('x-goog-channel-expiration'),
    });
  }
}
