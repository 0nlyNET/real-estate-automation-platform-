import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('tenant')
  async getTenantSettings(@Req() req: any) {
    const tenantId = req?.user?.tenantId;
    return this.settingsService.getTenantSettings(tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Put('tenant')
  async updateTenantSettings(
    @Req() req: any,
    @Body()
    body: {
      timeZone?: string;
      quietHoursStart?: string;
      quietHoursEnd?: string;
      bookingLink?: string;
      automationsEnabled?: boolean;
    },
  ) {
    const tenantId = req?.user?.tenantId;
    return this.settingsService.updateTenantSettings(tenantId, body);
  }
}
