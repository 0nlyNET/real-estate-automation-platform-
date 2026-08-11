import { sendSendGridEmail, sendTwilioSms } from './providers';

describe('provider HTTP adapters', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses exact SendGrid branding, Reply-To and correlation metadata and returns X-Message-Id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers({ 'x-message-id': 'provider-request-123' }),
    } as Response);
    await expect(
      sendSendGridEmail({
        apiKey: 'not-a-real-key',
        to: 'lead@example.com',
        fromEmail: 'agent@lakeview.example',
        fromName: 'Lakeview Realty',
        replyTo: 'replies@reply.lakeview.example',
        subject: 'Follow-up',
        text: 'Hello',
        categories: ['lead_follow_up'],
        customArgs: { rta_message_id: 'message-123' },
        headers: { 'In-Reply-To': '<inbound-123@example.com>' },
      }),
    ).resolves.toEqual({
      messageId: 'provider-request-123',
      status: 'accepted',
    });
    const request = fetchMock.mock.calls[0][1]!;
    const payload = JSON.parse(String(request.body));
    expect(payload).toMatchObject({
      from: { email: 'agent@lakeview.example', name: 'Lakeview Realty' },
      reply_to: { email: 'replies@reply.lakeview.example' },
      categories: ['lead_follow_up'],
      personalizations: [
        {
          custom_args: { rta_message_id: 'message-123' },
          headers: { 'In-Reply-To': '<inbound-123@example.com>' },
        },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain('not-a-real-key');
  });

  it.each([
    ['SendGrid', () => sendSendGridEmail({
      apiKey: 'test',
      to: 'lead@example.com',
      fromEmail: 'agent@example.com',
      subject: 'Test',
      text: 'Test',
    })],
    ['Twilio', () => sendTwilioSms({
      accountSid: 'AC123',
      authToken: 'test',
      to: '+15555550100',
      from: '+15555550101',
      body: 'Test',
    })],
  ] as const)('%s HTTP rejection is marked definitive for safe retry decisions', async (_provider, call) => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers(),
      json: async () => ({ message: 'Unavailable' }),
    } as Response);
    await expect(call()).rejects.toMatchObject({
      status: 503,
      definitiveRejection: true,
    });
  });
});
