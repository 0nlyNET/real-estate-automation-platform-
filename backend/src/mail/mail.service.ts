import { Injectable } from '@nestjs/common';
import { sendSendGridEmail } from '../common/providers';

@Injectable()
export class MailService {
  async sendEmail(params: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }) {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) throw new Error('SENDGRID_API_KEY missing');
    const fromEmail = process.env.SENDGRID_FROM_EMAIL;
    if (!fromEmail) throw new Error('SENDGRID_FROM_EMAIL missing');

    const fromName = process.env.SENDGRID_FROM_NAME || 'RealtyTechAI';
    await sendSendGridEmail({
      apiKey,
      to: params.to,
      fromEmail,
      fromName,
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
    const appUrl = (
      process.env.FRONTEND_URL ||
      process.env.PUBLIC_APP_URL ||
      'http://localhost:3000'
    ).replace(/\/$/, '');
    const dashboardLink = `${appUrl}/app/dashboard`;

    const text =
      `Your RealtyTechAI workspace account has been created.\n\n` +
      `Next step: complete setup and testing. Service remains inactive until the readiness checks pass and an operator activates the workspace.\n` +
      `Open setup: ${dashboardLink}\n\n` +
      `If you need help, reply to this email.`;

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2 style="margin: 0 0 12px 0;">Welcome to RealtyTechAI</h2>
        <p style="margin: 0 0 12px 0;">Your workspace account has been created.</p>
        <p style="margin: 0 0 16px 0;">Complete setup and testing. Service remains inactive until readiness checks pass and an operator activates the workspace.</p>
        <p style="margin: 0 0 16px 0;">
          <a href="${dashboardLink}" style="display:inline-block;padding:10px 14px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;">Complete setup</a>
        </p>
        <p style="margin: 0; font-size: 12px; color: #6b7280;">Need help? Reply to this email and we’ll assist.</p>
      </div>
    `;

    return this.sendEmail({ to: params.to, subject, text, html });
  }
}
