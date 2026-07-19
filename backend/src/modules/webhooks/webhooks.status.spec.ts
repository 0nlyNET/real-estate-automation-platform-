import { UnauthorizedException } from '@nestjs/common';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { validTwilioSignature, WebhooksService } from './webhooks.service';

describe('Twilio delivery status callbacks', () => {
  const originalUrl = process.env.TWILIO_STATUS_CALLBACK_URL;
  const callbackUrl = 'https://api.example.com/webhooks/twilio/status';
  const authToken = 'twilio-auth-token';

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.TWILIO_STATUS_CALLBACK_URL;
    else process.env.TWILIO_STATUS_CALLBACK_URL = originalUrl;
  });

  function setup(initialStatus: Message['status'] = 'provider_accepted') {
    process.env.TWILIO_STATUS_CALLBACK_URL = callbackUrl;
    const lead = Object.assign(new Lead(), { id: 'lead-1', tenantId: 'tenant-1' });
    const message = Object.assign(new Message(), {
      id: 'message-1',
      providerMessageId: 'SM123',
      status: initialStatus,
      lead,
    });
    const messages = {
      findOne: jest.fn().mockResolvedValue(message),
      save: jest.fn(async (value) => value),
    };
    const credentials = {
      findOne: jest.fn().mockResolvedValue({
        encryptedValue: JSON.stringify({ connected: true, authToken }),
        tenant: { id: 'tenant-1' },
      }),
    };
    const operations = { createTask: jest.fn().mockResolvedValue({}) };
    const service = new WebhooksService(
      {} as any,
      credentials as any,
      {} as any,
      {} as any,
      {} as any,
      messages as any,
      operations as any,
    );
    return { service, message, messages, operations };
  }

  function signed(body: Record<string, unknown>) {
    const signature = require('crypto')
      .createHmac('sha1', authToken)
      .update(
        callbackUrl +
          Object.keys(body)
            .sort()
            .map((key) => `${key}${String(body[key] ?? '')}`)
            .join(''),
      )
      .digest('base64');
    expect(validTwilioSignature(callbackUrl, body, authToken, signature)).toBe(true);
    return { 'x-twilio-signature': signature };
  }

  it('records delivered and ignores a later lower-ranked duplicate callback', async () => {
    const { service, message, messages } = setup();
    const delivered = { MessageSid: 'SM123', MessageStatus: 'delivered' };
    await expect(service.handleTwilioStatus(delivered, signed(delivered))).resolves.toMatchObject({
      status: 'ok',
      messageStatus: 'delivered',
    });
    expect(message.deliveredAt).toBeInstanceOf(Date);
    const saveCount = messages.save.mock.calls.length;

    const duplicate = { MessageSid: 'SM123', MessageStatus: 'sent' };
    await service.handleTwilioStatus(duplicate, signed(duplicate));
    expect(message.status).toBe('delivered');
    expect(messages.save).toHaveBeenCalledTimes(saveCount);
  });

  it('records a delivery failure, sanitizes its visible reason, and opens an operation', async () => {
    const { service, message, operations } = setup();
    const body = {
      MessageSid: 'SM123',
      MessageStatus: 'undelivered',
      ErrorCode: '30007',
      ErrorMessage: 'Carrier rejected the message',
    };
    await service.handleTwilioStatus(body, signed(body));
    expect(message).toMatchObject({
      status: 'failed',
      providerStatus: 'undelivered',
      errorCode: '30007',
      sanitizedErrorMessage: 'Carrier rejected the message',
    });
    expect(operations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'messaging_failure', relatedEntityId: 'message-1' }),
    );
  });

  it('rejects an invalid callback signature before changing the message', async () => {
    const { service, messages } = setup();
    await expect(
      service.handleTwilioStatus(
        { MessageSid: 'SM123', MessageStatus: 'delivered' },
        { 'x-twilio-signature': 'invalid' },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(messages.save).not.toHaveBeenCalled();
  });
});
