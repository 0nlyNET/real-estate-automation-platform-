import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { sendSendGridEmail } from '../../common/providers';

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

    if (!salesInbox || !apiKey || !fromEmail) {
      throw new ServiceUnavailableException('Inquiry delivery is not configured');
    }

    try {
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

      await sendSendGridEmail({
        apiKey,
        to: salesInbox,
        fromEmail,
        replyTo: inquiry.email,
        subject,
        text: lines.join('\n'),
      });
    } catch {
      throw new ServiceUnavailableException('Inquiry could not be delivered');
    }

    return { ok: true };
  }
}
