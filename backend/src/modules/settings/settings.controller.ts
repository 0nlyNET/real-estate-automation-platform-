import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { SettingsService } from "./settings.service";
import { UpdateTenantSettingsDto } from "./settings.dto";
import { RequireRole, RolesGuard } from "../../common/guards/roles.guard";

@Controller("settings")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @UseGuards(AuthGuard("jwt"))
  @Get("tenant")
  getTenantSettings(@Req() req: any) {
    return this.settingsService.getTenantSettings(req.user.tenantId);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @RequireRole("admin")
  @Put("tenant")
  updateTenantSettings(@Req() req: any, @Body() body: UpdateTenantSettingsDto) {
    return this.settingsService.updateTenantSettings(req.user.tenantId, body);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @RequireRole("admin")
  @Post("intake-key/rotate")
  rotateIntakeKey(@Req() req: any) {
    return this.settingsService.rotateIntakeKey(req.user.tenantId);
  }

  @UseGuards(AuthGuard("jwt"), RolesGuard)
  @RequireRole("admin")
  @Post("booking-link/verify")
  verifyBookingLink(@Req() req: any) {
    return this.settingsService.verifyBookingLink(req.user.tenantId);
  }
}
