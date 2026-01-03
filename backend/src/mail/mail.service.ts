import { Injectable, Logger } from '@nestjs/common';
import * as sgMail from '@sendgrid/mail';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor() {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      this.logger.error('SENDGRID_API_KEY missing');
    } else {
      sgMail.setApiKey(apiKey);
    }
  }

  async sendEmail(params: { to: string; subject: string; text: string }) {
    const from = process.env.SENDGRID_FROM_EMAIL;
    if (!from) throw new Error('SENDGRID_FROM_EMAIL missing');

    await sgMail.send({
      to: params.to,
      from,
      subject: params.subject,
      text: params.text,
    });
  }
}

