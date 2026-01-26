import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Request } from "express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MessagingService } from "./messaging.service";

@Controller("messaging")
export class MessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Post("test-email")
  async testEmail(@Body() body: any) {
    return this.messagingService.testEmail(body);
  }

  @Post("webhooks/twilio/sms")
  async twilioSmsWebhook(@Req() req: Request) {
    return this.messagingService.handleTwilioSmsWebhook(req);
  }

  @Post("webhooks/sendgrid/inbound")
  async sendgridInboundWebhook(@Req() req: Request) {
    return this.messagingService.handleSendgridInboundWebhook(req);
  }

  @Post("process")
  async process(@Body() body: any) {
    return this.messagingService.process(body);
  }

  @UseGuards(JwtAuthGuard)
  @Get("threads")
  async getThreads(
    @Req() req: Request,
    @Query("take") take?: string,
    @Query("skip") skip?: string,
    @Query("scope") scope?: string,
  ) {
    const user: any = (req as any).user;
    const tenantId = user?.tenantId;

    const takeNum = Math.min(Math.max(parseInt(take || "50", 10) || 50, 1), 200);
    const skipNum = Math.max(parseInt(skip || "0", 10) || 0, 0);

    const normalizedScope = scope === "mine" ? "mine" : scope === "team" ? "team" : "shared";

    return this.messagingService.listThreads(tenantId, takeNum, skipNum, {
      userId: user?.userId,
      role: user?.role,
      teamId: user?.teamId || null,
      scope: normalizedScope,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get("threads/:leadId")
  async getThreadMessages(@Req() req: Request, @Param("leadId") leadId: string) {
    const user: any = (req as any).user;
    const tenantId = user?.tenantId;
    return this.messagingService.getThreadMessages(tenantId, leadId);
  }

  @UseGuards(JwtAuthGuard)
  @Post("send")
  async send(@Req() req: Request, @Body() body: any) {
    const user: any = (req as any).user;
    return this.messagingService.sendManualMessage(user?.tenantId, user?.userId, body);
  }
}
