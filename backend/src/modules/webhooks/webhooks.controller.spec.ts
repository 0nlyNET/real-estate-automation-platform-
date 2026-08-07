import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import {
  issueSendGridInboundAccessToken,
  SendGridInboundAuthorizationError,
} from './sendgrid-inbound-oauth';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

describe('WebhooksController SendGrid inbound authorization', () => {
  const original = { ...process.env };
  let app: INestApplication;
  let webhooks: {
    handleSendGridInbound: jest.Mock;
    handleSendGridEvents: jest.Mock;
  };

  beforeEach(async () => {
    process.env.SENDGRID_INBOUND_USERNAME = 'rta_sendgrid_inbound';
    process.env.SENDGRID_INBOUND_PASSWORD = 'strong-test-password';
    webhooks = {
      handleSendGridInbound: jest.fn().mockResolvedValue({ status: 'ok' }),
      handleSendGridEvents: jest.fn().mockResolvedValue({
        status: 'ok',
        processed: 1,
        duplicates: 0,
        ignored: 0,
      }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [{ provide: WebhooksService, useValue: webhooks }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  function issueToken() {
    return issueSendGridInboundAccessToken({
      grant_type: 'client_credentials',
      client_id: 'rta_sendgrid_inbound',
      client_secret: 'strong-test-password',
      scope: 'webhooks:write',
    }).access_token;
  }

  it('accepts a lowercase Bearer header through the real HTTP controller path', async () => {
    const token = issueToken();

    await request(app.getHttpServer())
      .post('/webhooks/sendgrid/inbound')
      .set('Authorization', `bearer ${token}`)
      .field('from', 'Jordan Client <jordan@example.com>')
      .field('to', 'replies@reply.lakeview.example')
      .field('text', 'Controller authorization test')
      .expect(201)
      .expect({ status: 'ok' });

    expect(webhooks.handleSendGridInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Jordan Client <jordan@example.com>',
        text: 'Controller authorization test',
      }),
      `Basic ${Buffer.from(
        'rta_sendgrid_inbound:strong-test-password',
      ).toString('base64')}`,
    );
  });

  it('logs a safe reason without logging the rejected credential', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    await request(app.getHttpServer())
      .post('/webhooks/sendgrid/inbound')
      .set('Authorization', 'Digest do-not-log-this-value')
      .field('from', 'Jordan Client <jordan@example.com>')
      .expect(401);

    expect(webhooks.handleSendGridInbound).not.toHaveBeenCalled();
    const rejectionLog = warn.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes('invalid_webhook_signature'));
    expect(rejectionLog).toContain('unsupported_scheme');
    expect(rejectionLog).toContain('digest');
    expect(rejectionLog).not.toContain('do-not-log-this-value');
  });

  it('awaits the service so asynchronous authorization failures are diagnosed safely', async () => {
    const token = issueToken();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    webhooks.handleSendGridInbound.mockRejectedValueOnce(
      new SendGridInboundAuthorizationError('expired_token', 'bearer'),
    );

    await request(app.getHttpServer())
      .post('/webhooks/sendgrid/inbound')
      .set('Authorization', `Bearer ${token}`)
      .field('from', 'Jordan Client <jordan@example.com>')
      .expect(401);

    const rejectionLog = warn.mock.calls
      .map(([message]) => String(message))
      .find((message) => message.includes('invalid_webhook_signature'));
    expect(rejectionLog).toContain('expired_token');
    expect(rejectionLog).not.toContain(token);
  });

  it('authenticates SendGrid delivery events with the same OAuth bearer flow', async () => {
    const token = issueToken();
    const payload = [
      {
        event: 'delivered',
        sg_event_id: 'event-123',
        sg_message_id: 'message-123',
      },
    ];
    await request(app.getHttpServer())
      .post('/webhooks/sendgrid/events')
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(200)
      .expect({ status: 'ok', processed: 1, duplicates: 0, ignored: 0 });
    expect(webhooks.handleSendGridEvents).toHaveBeenCalledWith(
      payload,
      `Basic ${Buffer.from(
        'rta_sendgrid_inbound:strong-test-password',
      ).toString('base64')}`,
    );
  });
});
