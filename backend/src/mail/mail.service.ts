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

  async sendEmail(params: { to: string; subject: string; text: string; html?: string }) {
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    if (!fromEmail) throw new Error('SENDGRID_FROM_EMAIL missing');

    const fromName = process.env.SENDGRID_FROM_NAME || 'RealtyTechAI';
    const from = { email: fromEmail, name: fromName };

    await sgMail.send({
      to: params.to,
      from,
      subject: params.subject,
      text: params.text,
      ...(params.html ? { html: params.html } : {}),
    });
  }

  async sendVerificationEmail(params: { to: string; verifyLink: string }) {
    const subject = 'Verify your RealtyTechAI email';
    const text =
      `Welcome to RealtyTechAI.\n\n` +
      `Verify your email to activate your account:\n${params.verifyLink}\n\n` +
      `If you did not create this account, you can ignore this email.`;

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2 style="margin: 0 0 12px 0;">Verify your email</h2>
        <p style="margin: 0 0 12px 0;">Click the button below to verify your RealtyTechAI account.</p>
        <p style="margin: 0 0 16px 0;">
          <a href="${params.verifyLink}" style="display:inline-block;padding:10px 14px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;">Verify email</a>
        </p>
        <p style="margin: 0 0 8px 0; font-size: 12px; color: #6b7280;">If the button doesn't work, paste this link in your browser:</p>
        <p style="margin: 0; font-size: 12px; color: #6b7280;">${params.verifyLink}</p>
      </div>
    `;

    return this.sendEmail({ to: params.to, subject, text, html });
  }

  async sendWelcomeEmail(params: { to: string }) {
    const subject = 'Welcome to RealtyTechAI';
    const appUrl = (process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    const dashboardLink = `${appUrl}/app/onboarding`;

    const text =
      `You're in.\n\n` +
      `Next step: finish setup so leads and messages flow automatically.\n` +
      `Open setup: ${dashboardLink}\n\n` +
      `If you need help, reply to this email.`;

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2 style="margin: 0 0 12px 0;">Welcome to RealtyTechAI</h2>
        <p style="margin: 0 0 12px 0;">You're in. Your account is ready.</p>
        <p style="margin: 0 0 16px 0;">Finish setup so leads, SMS, and email automations run smoothly.</p>
        <p style="margin: 0 0 16px 0;">
          <a href="${dashboardLink}" style="display:inline-block;padding:10px 14px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;">Complete setup</a>
        </p>
        <p style="margin: 0; font-size: 12px; color: #6b7280;">Need help? Reply to this email and we’ll assist.</p>
      </div>
    `;

    return this.sendEmail({ to: params.to, subject, text, html });
  }
}

