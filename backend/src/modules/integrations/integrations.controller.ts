import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { IntegrationsService } from "./integrations.service";
import {
  TestSendGridDto,
  TestTwilioDto,
  UpsertSendGridDto,
  UpsertTwilioDto,
} from "./integrations.dto";
import { RequireRole, RolesGuard } from "../../common/guards/roles.guard";

@Controller("integrations")
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@Req() req: any) {
    return this.integrationsService.list(req.user?.tenantId);
  }

  @Put("twilio")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole("admin")
  async connectTwilio(@Body() _dto: UpsertTwilioDto) {
    throw new ForbiddenException(
      "Twilio credentials are managed by RealtyTechAI operations. Contact support to change the assigned number.",
    );
  }

  @Post("twilio/test")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole("admin")
  async testTwilio(@Body() _dto: TestTwilioDto) {
    throw new ForbiddenException(
      "Twilio testing is managed by RealtyTechAI operations.",
    );
  }

  @Put("sendgrid")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole("admin")
  async connectSendGrid(@Body() _dto: UpsertSendGridDto) {
    throw new ForbiddenException(
      "SendGrid credentials are managed by RealtyTechAI operations. Contact support to change the assigned sender.",
    );
  }

  @Post("sendgrid/test")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole("admin")
  async testSendGrid(@Body() _dto: TestSendGridDto) {
    throw new ForbiddenException(
      "SendGrid testing is managed by RealtyTechAI operations.",
    );
  }

  @Delete(":provider")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole("admin")
  async disconnect(@Req() req: any, @Param("provider") provider: string) {
    if (!["twilio", "sendgrid"].includes(provider)) {
      throw new BadRequestException("Unsupported integration provider");
    }
    if (provider === "twilio" || provider === "sendgrid") {
      throw new ForbiddenException(
        "Messaging providers are managed by RealtyTechAI operations.",
      );
    }
    return this.integrationsService.disconnect(
      req.user?.tenantId,
      provider as any,
    );
  }

}
