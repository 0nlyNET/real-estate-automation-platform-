import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

@UseGuards(JwtAuthGuard)
@Controller("messaging")
export class MessagingController {
  @Get("messages")
  async getMessages(@Query("scope") scope?: string, @Req() req?: any) {
    const normalizedScope: "mine" | "shared" | undefined =
      scope === "shared" ? "shared" : "mine";

    return {
      ok: true,
      scope: normalizedScope,
      user: req?.user ?? null,
      items: [],
    };
  }

  @Post("manual")
  async sendManual(@Body() body: any, @Req() req?: any) {
    return {
      ok: true,
      user: req?.user ?? null,
      received: body ?? null,
      queued: false,
      note: "Manual send is temporarily stubbed to unblock build",
    };
  }
}
