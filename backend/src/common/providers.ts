type SendGridEmail = {
  apiKey: string;
  to: string;
  fromEmail: string;
  fromName?: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendSendGridEmail(message: SendGridEmail): Promise<void> {
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${message.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: message.to }] }],
      from: { email: message.fromEmail, name: message.fromName || 'RealtyTechAI' },
      ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
      subject: message.subject,
      content: [
        { type: 'text/plain', value: message.text },
        ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    throw new Error(`SendGrid request failed (${response.status})`);
  }
}

type TwilioSms = {
  accountSid: string;
  authToken: string;
  to: string;
  body: string;
  from?: string;
  messagingServiceSid?: string;
};

export async function sendTwilioSms(message: TwilioSms): Promise<{ sid?: string }> {
  const form = new URLSearchParams({ To: message.to, Body: message.body });
  if (message.messagingServiceSid) form.set('MessagingServiceSid', message.messagingServiceSid);
  else if (message.from) form.set('From', message.from);

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

  const payload = await response.json().catch(() => ({})) as { sid?: string; message?: string };
  if (!response.ok) throw new Error(payload.message || `Twilio request failed (${response.status})`);
  return { sid: payload.sid };
}
