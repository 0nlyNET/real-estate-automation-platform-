import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { LeadIngestionService } from "./lead-ingestion.service";

type RequestWithCorrelationId = Request & { correlationId?: string };

@Controller("api/v1/ingest")
export class LeadIngestionController {
  constructor(private readonly leadIngestion: LeadIngestionService) {}

  @Post("lead")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  ingestLead(
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() request: RequestWithCorrelationId,
  ) {
    return this.leadIngestion.ingest({
      body,
      headers,
      correlationId:
        request.correlationId || String(request.header("x-request-id") || ""),
    });
  }
}
