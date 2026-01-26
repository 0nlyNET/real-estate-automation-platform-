import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { SettingsService } from "./settings.service";

class UpdateTenantSettingsDto {
  timeZone?: string;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  bookingLink?: string;
  automationsEnabled?: boolean;
  roundRobinEnabled?: boolean;
  roundRobinTeamId?: string | null;
}

@Controller("settings")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @UseGuards(AuthGuard("jwt"))
  @Get("tenant")
  getTenantSettings(@Req() req: any) {
    return this.settingsService.getTenantSettings(req.user.tenantId);
  }

  @UseGuards(AuthGuard("jwt"))
  @Put("tenant")
  updateTenantSettings(@Req() req: any, @Body() body: UpdateTenantSettingsDto) {
    return this.settingsService.updateTenantSettings(req.user.tenantId, body);
  }
}
