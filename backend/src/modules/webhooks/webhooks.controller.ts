import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  Logger,
  Post,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { WebhooksService } from './webhooks.service';
import {
  issueSendGridInboundAccessToken,
  normalizeSendGridInboundAuthorization,
  SendGridInboundAuthorizationError,
} from './sendgrid-inbound-oauth';
import { operationalEvent } from '../../common/operational-log';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooks: WebhooksService) {}

  @Post('twilio/inbound')
  async twilioInbound(
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res() res: Response,
  ) {
    await this.webhooks.handleTwilioInbound(body, headers);

    res.type('text/xml');
    return res.send(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    );
  }

  @Post('twilio/status')
  async twilioStatus(
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return await this.webhooks.handleTwilioStatus(body, headers);
  }

  @Post('sendgrid/oauth/token')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  sendGridOauthToken(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    return issueSendGridInboundAccessToken(body, authorization || '');
  }

  @Post('sendgrid/inbound')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        fields: 30,
        files: 5,
        fileSize: 2_000_000,
        fieldSize: 1_000_000,
      },
    }),
  )
  async sendGridInbound(
    @Body() body: any,
    @Headers('authorization') authorization?: string,
  ) {
    try {
      return await this.webhooks.handleSendGridInbound(
        body,
        normalizeSendGridInboundAuthorization(authorization || ''),
      );
    } catch (error) {
      if (error instanceof SendGridInboundAuthorizationError) {
        this.logger.warn(
          operationalEvent('invalid_webhook_signature', {
            provider: 'sendgrid',
            webhook: 'inbound',
            reason: error.reason,
            scheme: error.scheme || null,
            authorizationPresent: Boolean(String(authorization || '').trim()),
          }),
        );
      }
      throw error;
    }
  }

  @Post('sendgrid/events')
  @HttpCode(200)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async sendGridEvents(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    try {
      return await this.webhooks.handleSendGridEvents(
        body,
        normalizeSendGridInboundAuthorization(authorization || ''),
      );
    } catch (error) {
      if (error instanceof SendGridInboundAuthorizationError) {
        this.logger.warn(
          operationalEvent('invalid_webhook_signature', {
            provider: 'sendgrid',
            webhook: 'events',
            reason: error.reason,
            scheme: error.scheme || null,
            authorizationPresent: Boolean(String(authorization || '').trim()),
          }),
        );
      }
      throw error;
    }
  }

}
