import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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
  twilioStatus(
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.webhooks.handleTwilioStatus(body, headers);
  }

  @Post('sendgrid/oauth/token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  sendGridOauthToken(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
  ) {
    return issueSendGridInboundAccessToken(body, authorization || '');
  }

  @Post('sendgrid/inbound')
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
  sendGridInbound(
    @Body() body: any,
    @Headers('authorization') authorization?: string,
  ) {
    try {
      return this.webhooks.handleSendGridInbound(
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

  @Get('facebook/lead-ads')
  facebookVerify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') verifyToken: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() res: Response,
  ) {
    const verified = this.webhooks.verifyFacebookWebhook(
      mode,
      verifyToken,
      challenge,
    );
    return res.status(200).send(verified);
  }

  @Post('facebook/lead-ads')
  async facebookLeadAds(
    @Req() req: Request & { rawBody?: Buffer },
    @Body() body: any,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    return this.webhooks.handleFacebookLeadAds(
      body,
      req.rawBody,
      signature || '',
    );
  }
}
