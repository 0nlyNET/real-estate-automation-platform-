import { Injectable } from '@nestjs/common';
import sgMail from '@sendgrid/mail';

type Inquiry = {
  name?: string;
  email: string;
  company?: string;
  topic?: string;
  message: string;
  source?: string;
};

@Injectable()
export class PublicService {
  async submitInquiry(inquiry: Inquiry) {
    const salesInbox = (process.env.SALES_INBOX_EMAIL || '').trim();
    const apiKey = (process.env.SENDGRID_API_KEY || '').trim();
    const fromEmail = (process.env.SENDGRID_FROM_EMAIL || '').trim();

    // Always succeed from the client's perspective.
    // If email delivery is not configured, we still log the inquiry.
    try {
      // eslint-disable-next-line no-console
      console.log('[PUBLIC_INQUIRY]', {
        name: inquiry.name || null,
        email: inquiry.email,
        company: inquiry.company || null,
        topic: inquiry.topic || 'sales',
        source: inquiry.source || null,
        message: inquiry.message,
      });

      if (!salesInbox || !apiKey || !fromEmail) {
        return { ok: true };
      }

      sgMail.setApiKey(apiKey);

      const subjectTopic = (inquiry.topic || 'sales').toString().toUpperCase();
      const subject = `[RealtyTechAI] ${subjectTopic} inquiry from ${inquiry.email}`;

      const lines = [
        `Topic: ${inquiry.topic || 'sales'}`,
        `Name: ${inquiry.name || ''}`,
        `Email: ${inquiry.email}`,
        `Company: ${inquiry.company || ''}`,
        `Source: ${inquiry.source || ''}`,
        '',
        inquiry.message,
      ];

      await sgMail.send({
        to: salesInbox,
        from: fromEmail,
        replyTo: inquiry.email,
        subject,
        text: lines.join('\n'),
      });
    } catch (e: any) {
      // eslint-disable-next-line no-console
      console.warn('[PUBLIC_INQUIRY_SEND_FAILED]', e?.message || e);
    }

    return { ok: true };
  }
}
