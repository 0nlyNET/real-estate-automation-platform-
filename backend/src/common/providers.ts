type SendGridEmail = {
  apiKey: string;
  to: string;
  fromEmail: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  customArgs?: Record<string, string>;
  headers?: Record<string, string>;
  categories?: string[];
};

export type ProviderRequestError = Error & {
  status: number;
  definitiveRejection: true;
};

export async function sendSendGridEmail(
  message: SendGridEmail,
): Promise<{ messageId?: string; status: 'accepted' }> {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${message.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: message.to }],
          ...(message.customArgs
            ? { custom_args: message.customArgs }
            : {}),
          ...(message.headers ? { headers: message.headers } : {}),
        },
      ],
      from: { email: message.fromEmail, name: message.fromName || 'RealtyTechAI' },
      ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
      ...(message.categories?.length
        ? { categories: message.categories.slice(0, 10) }
        : {}),
      subject: message.subject,
      content: [
        { type: 'text/plain', value: message.text },
        ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const error = new Error(
      `SendGrid request failed [HTTP ${response.status}]`,
    ) as ProviderRequestError;
    error.status = response.status;
    error.definitiveRejection = true;
    throw error;
  }
  return {
    messageId: response.headers.get('x-message-id')?.trim() || undefined,
    status: 'accepted',
  };
}

type TwilioSms = {
  accountSid: string;
  authToken: string;
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
  statusCallback?: string;
};

export async function sendTwilioSms(message: TwilioSms): Promise<{ sid?: string; status?: string }> {
  const form = new URLSearchParams({ To: message.to, Body: message.body });
  if (message.messagingServiceSid) form.set('MessagingServiceSid', message.messagingServiceSid);
  else if (message.from) form.set('From', message.from);
  if (message.statusCallback) form.set('StatusCallback', message.statusCallback);

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(message.accountSid)}/Messages.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${message.accountSid}:${message.authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });

  const payload = await response.json().catch(() => ({})) as { sid?: string; status?: string; message?: string };
  if (!response.ok) {
    const error = new Error(
      `${payload.message || 'Twilio request failed'} [HTTP ${response.status}]`,
    ) as ProviderRequestError;
    error.status = response.status;
    error.definitiveRejection = true;
    throw error;
  }
  return { sid: payload.sid, status: payload.status };
}
