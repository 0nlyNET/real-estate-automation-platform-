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
import type { Request, Response } from 'express';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CalendarService } from './calendar.service';
import {
  CheckAvailabilityDto,
  SelectBookingProviderDto,
  SelectCalendarDto,
} from './calendar.dto';
import { BookingProviderRegistry } from './booking-provider.registry';
import { CalendlyService } from './calendly.service';
import { MicrosoftCalendarService } from './microsoft-calendar.service';

@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly providers: BookingProviderRegistry,
    private readonly microsoft: MicrosoftCalendarService,
    private readonly calendly: CalendlyService,
  ) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  status(@Req() req: any) {
    return this.providers.status(req.user?.tenantId);
  }

  @Put('active')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  setActive(@Req() req: any, @Body() body: SelectBookingProviderDto) {
    return this.providers.setActive(
      req.user?.tenantId,
      body.provider,
      req.user?.sub,
    );
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
    return this.providerCallback(
      response,
      'google',
      error,
      code,
      state,
      () => this.calendar.completeGoogleOAuth(code!, state!),
    );
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
    return this.providers.active(req.user?.tenantId).then((provider) =>
      provider.checkAvailability(
        req.user?.tenantId,
        new Date(body.startsAt),
        new Date(body.endsAt),
      ),
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

  @Post('microsoft/oauth/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  startMicrosoft(@Req() req: any) {
    return this.microsoft.startOAuth(req.user?.tenantId, req.user?.sub);
  }

  @Get('microsoft/oauth/callback')
  async microsoftCallback(
    @Res() response: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    return this.providerCallback(
      response,
      'microsoft',
      error,
      code,
      state,
      () => this.microsoft.completeOAuth(code!, state!),
    );
  }

  @Get('microsoft/resources')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  listMicrosoft(@Req() req: any) {
    return this.microsoft.listResources(req.user?.tenantId);
  }

  @Put('microsoft/selection')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  selectMicrosoft(@Req() req: any, @Body() body: SelectCalendarDto) {
    return this.microsoft.selectResource(
      req.user?.tenantId,
      body.calendarId,
      req.user?.sub,
    );
  }

  @Post('microsoft/test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  testMicrosoft(@Req() req: any) {
    return this.microsoft.testConnection(req.user?.tenantId, req.user?.sub);
  }

  @Delete('microsoft')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  disconnectMicrosoft(@Req() req: any) {
    return this.microsoft.disconnect(req.user?.tenantId, req.user?.sub);
  }

  @Post('microsoft/notifications')
  async microsoftNotifications(
    @Res() response: Response,
    @Query('validationToken') validationToken?: string,
    @Body() body?: { value?: any[] },
  ) {
    if (validationToken !== undefined) {
      if (
        !validationToken ||
        validationToken.length > 4_096 ||
        /[\r\n]/.test(validationToken)
      ) {
        return response.status(400).type('text/plain').send('invalid token');
      }
      return response.status(200).type('text/plain').send(validationToken);
    }
    await this.microsoft.handleNotifications(
      Array.isArray(body?.value) ? body!.value!.slice(0, 100) : [],
    );
    return response.status(202).send();
  }

  @Post('calendly/oauth/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  startCalendly(@Req() req: any) {
    return this.calendly.startOAuth(req.user?.tenantId, req.user?.sub);
  }

  @Get('calendly/oauth/callback')
  async calendlyCallback(
    @Res() response: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    return this.providerCallback(
      response,
      'calendly',
      error,
      code,
      state,
      () => this.calendly.completeOAuth(code!, state!),
    );
  }

  @Get('calendly/resources')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  listCalendly(@Req() req: any) {
    return this.calendly.listResources(req.user?.tenantId);
  }

  @Put('calendly/selection')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  selectCalendly(@Req() req: any, @Body() body: SelectCalendarDto) {
    return this.calendly.selectResource(
      req.user?.tenantId,
      body.calendarId,
      req.user?.sub,
    );
  }

  @Post('calendly/test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  testCalendly(@Req() req: any) {
    return this.calendly.testConnection(req.user?.tenantId, req.user?.sub);
  }

  @Delete('calendly')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  disconnectCalendly(@Req() req: any) {
    return this.calendly.disconnect(req.user?.tenantId, req.user?.sub);
  }

  @Post('calendly/notifications')
  @HttpCode(202)
  calendlyNotifications(
    @Req() request: Request & { rawBody?: Buffer },
    @Query('connection') connectionId?: string,
    @Query('token') callbackToken?: string,
    @Headers('calendly-webhook-signature') signature?: string,
    @Body() body?: unknown,
  ) {
    return this.calendly.handleWebhook(
      String(connectionId || ''),
      String(callbackToken || ''),
      request.rawBody,
      String(signature || ''),
      body,
    );
  }

  private async providerCallback(
    response: Response,
    provider: 'google' | 'microsoft' | 'calendly',
    error: string | undefined,
    code: string | undefined,
    state: string | undefined,
    complete: () => Promise<unknown>,
  ) {
    const frontend = String(
      process.env.FRONTEND_URL ||
        process.env.PUBLIC_APP_URL ||
        'http://localhost:3000',
    ).replace(/\/+$/, '');
    if (error) {
      return response.redirect(
        `${frontend}/app/integrations?scheduling=${provider}&status=error&code=OAUTH_DENIED`,
      );
    }
    if (!code || !state) {
      return response.redirect(
        `${frontend}/app/integrations?scheduling=${provider}&status=error&code=OAUTH_CALLBACK_INVALID`,
      );
    }
    try {
      await complete();
      return response.redirect(
        `${frontend}/app/integrations?scheduling=${provider}&status=choose`,
      );
    } catch (cause: any) {
      const errorCode = String(
        cause?.response?.code || cause?.code || 'OAUTH_FAILED',
      ).replace(/[^A-Z0-9_]/gi, '');
      return response.redirect(
        `${frontend}/app/integrations?scheduling=${provider}&status=error&code=${encodeURIComponent(errorCode)}`,
      );
    }
  }
}
