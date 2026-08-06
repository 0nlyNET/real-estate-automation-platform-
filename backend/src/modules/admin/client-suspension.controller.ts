import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { PlatformAdminGuard } from "../../common/guards/platform-admin.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ServiceControlService } from "../service-control/service-control.service";
import { SuspendClientDto } from "./admin.dto";

type AdminRequest = Request & {
  correlationId?: string;
  user?: { sub?: string; email?: string };
};

@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller("api/v1/admin/clients")
export class ClientSuspensionController {
  constructor(private readonly serviceControl: ServiceControlService) {}

  @Post(":clientId/suspend")
  suspendClient(
    @Param("clientId", new ParseUUIDPipe({ version: "4" })) clientId: string,
    @Body() body: SuspendClientDto,
    @Req() request: AdminRequest,
  ) {
    return this.serviceControl.suspend({
      tenantId: clientId,
      reason: body.reason || "Suspended by a platform administrator.",
      internalNote: body.internalNote,
      source: "manual",
      actor: {
        id: String(request.user?.sub || ""),
        email: String(request.user?.email || ""),
      },
      requestCorrelationId:
        request.correlationId || String(request.header("x-request-id") || ""),
      auditPath: `/api/v1/admin/clients/${clientId}/suspend`,
    });
  }
}
