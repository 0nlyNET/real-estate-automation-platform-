import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { IntegrationsService } from "./integrations.service";
import {
  TestSendGridDto,
  TestTwilioDto,
  SelectFacebookPageDto,
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
  async connectTwilio(@Req() req: any, @Body() dto: UpsertTwilioDto) {
    // your service does NOT have saveTwilio; it has connectTwilio
    return this.integrationsService.connectTwilio(
      req.user?.tenantId,
      dto as any,
    );
  }

  @Post("twilio/test")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole("admin")
  async testTwilio(@Req() req: any, @Body() dto: TestTwilioDto) {
    // your service signature requires dto
    return this.integrationsService.testTwilio(req.user?.tenantId, dto);
  }

  @Put("sendgrid")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole("admin")
  async connectSendGrid(@Req() req: any, @Body() dto: UpsertSendGridDto) {
    // your service does NOT have saveSendGrid; it has connectSendGrid
    return this.integrationsService.connectSendGrid(
      req.user?.tenantId,
      dto as any,
    );
  }

  @Post("sendgrid/test")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole("admin")
  async testSendGrid(@Req() req: any, @Body() dto: TestSendGridDto) {
    // your service signature requires dto
    return this.integrationsService.testSendGrid(req.user?.tenantId, dto);
  }

  @Delete(":provider")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole("admin")
  async disconnect(@Req() req: any, @Param("provider") provider: string) {
    if (!["twilio", "sendgrid", "facebook_lead_ads"].includes(provider)) {
      throw new BadRequestException("Unsupported integration provider");
    }
    return this.integrationsService.disconnect(
      req.user?.tenantId,
      provider as any,
    );
  }

  /**
   * Facebook Lead Ads OAuth: return the URL the frontend should redirect the user to.
   * We keep this simple and stable:
   * - state = tenantId
   * - redirect_uri = {backend}/integrations/facebook/callback
   */
  @Get("facebook/connect")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole("admin")
  async facebookConnect(@Req() req: any) {
    const result = await this.integrationsService.facebookOAuthStart(
      req.user?.tenantId,
    );
    return { ok: true, ...result };
  }

  @Get("facebook/pages")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole("admin")
  async facebookPages(@Req() req: any) {
    return this.integrationsService.listFacebookPages(req.user?.tenantId);
  }

  @Post("facebook/page")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole("admin")
  async facebookPage(@Req() req: any, @Body() body: SelectFacebookPageDto) {
    return this.integrationsService.selectFacebookPage(
      req.user?.tenantId,
      body.pageId,
    );
  }

  /**
   * Facebook OAuth callback:
   * - code + state come from Facebook
   * - your service already has facebookOAuthCallback(code, state)
   * - redirect back to frontend integrations page with a result flag
   */
  @Get("facebook/callback")
  async facebookCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("error") error?: string,
    @Query("error_description") errorDescription?: string,
  ) {
    const frontend = process.env.FRONTEND_URL || "http://localhost:3000";

    if (error) {
      const msg = errorDescription ? String(errorDescription) : String(error);
      return res.redirect(
        `${frontend}/app/integrations?facebook=error&message=${encodeURIComponent(msg)}`,
      );
    }

    if (!code || !state) {
      return res.redirect(
        `${frontend}/app/integrations?facebook=error&message=${encodeURIComponent("Missing code/state")}`,
      );
    }

    const result = await this.integrationsService.facebookOAuthCallback(
      String(code),
      String(state),
    );

    if (result?.ok) {
      return res.redirect(`${frontend}/app/integrations?facebook=success`);
    }

    const msg = result?.error
      ? String(result.error)
      : "Facebook connect failed";
    return res.redirect(
      `${frontend}/app/integrations?facebook=error&message=${encodeURIComponent(msg)}`,
    );
  }
}
