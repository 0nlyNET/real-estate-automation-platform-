import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { sendSendGridEmail } from '../common/providers';
import { PlatformCredential } from '../modules/integrations/platform-credential.entity';
import { decryptIntegrationPayload } from '../modules/integrations/integrations.service';

@Injectable()
export class MailService {
  constructor(
    @Optional()
    @InjectRepository(PlatformCredential)
    private readonly platformCredentials?: Repository<PlatformCredential>,
  ) {}

  async sendEmail(params: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }) {
    const managed = await this.platformCredentials?.findOne({
      where: { provider: 'sendgrid' },
    });
    const managedPayload = managed
      ? decryptIntegrationPayload(managed.encryptedValue)
      : null;
    const apiKey = String(managedPayload?.apiKey || process.env.SENDGRID_API_KEY || '').trim();
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
      categories: ['transactional'],
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

  async sendAccountInvitation(params: { to: string; invitationLink: string }) {
    const subject = 'Set up your RealtyTechAI account';
    const text =
      `Your RealtyTechAI workspace is ready for setup.\n\n` +
      `Choose your password using this single-use link:\n${params.invitationLink}\n\n` +
      `The link expires in 24 hours. RealtyTechAI will never email you a password.`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2 style="margin:0 0 12px">Set up your RealtyTechAI account</h2>
        <p>Choose your own password using this single-use invitation. The link expires in 24 hours.</p>
        <p><a href="${params.invitationLink}" style="display:inline-block;padding:10px 14px;background:#111827;color:#fff;text-decoration:none;border-radius:6px">Choose password</a></p>
        <p style="font-size:12px;color:#6b7280">RealtyTechAI will never email you a password. If the button does not work, paste this link into your browser: ${params.invitationLink}</p>
      </div>`;
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
