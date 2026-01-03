import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Resend } from 'resend';

import { Lead } from '../leads/lead.entity';
import { Message } from './message.entity';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);
  private resend = new Resend(process.env.RESEND_API_KEY);

  constructor(
    @InjectRepository(Message)
    private readonly messagesRepository: Repository<Message>,
    private readonly queueService: QueueService,
  ) {}

  private async sendEmail(opts: { to: string; subject: string; html: string; lead?: Lead }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;

    if (!apiKey) throw new Error('RESEND_API_KEY is missing');
    if (!from) throw new Error('EMAIL_FROM is missing');

    const res = await this.resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });

    if (opts.lead) {
      await this.recordMessage({
        lead: opts.lead,
        channel: 'email',
        direction: 'outbound',
        body: `SUBJECT: ${opts.subject}\n\n${opts.html}`,
        providerMessageId: (res as any)?.data?.id ?? undefined,
      });
    }

    return res;
  }

  async queueInstantResponses(lead: Lead) {
  // Keep the queue calls if you want them later
  // await this.queueService.enqueueImmediateSms(lead);
  // await this.queueService.enqueueImmediateEmail(lead);

  const bookingLink = 'https://example.com'; // temporary until tenant settings are wired

  // Resend testing: only sends to your "own email"
  const leadTo = process.env.DEMO_EMAIL_TO!;
const agentTo = process.env.DEMO_AGENT_EMAIL!;

if (!leadTo || !agentTo) {
  this.logger.warn('Demo email vars missing, skipping messaging');
  return;
}
  await this.sendLeadAutoReply({
    leadEmail: leadTo,
    leadName: (lead as any).fullName ?? 'there',
    bookingLink,
    lead,
  });

  await this.sendAgentNewLeadAlert({
    agentEmail: agentTo,
    leadName: (lead as any).fullName ?? 'Unknown',
    leadEmail: lead.email,
    leadPhone: (lead as any).phone,
    lead,
  });
}
  async recordMessage(message: Partial<Message>) {
    const saved = this.messagesRepository.create(message);
    return this.messagesRepository.save(saved);
  }

  async sendLeadAutoReply(params: {
    leadEmail: string;
    leadName: string;
    bookingLink?: string;
    lead?: Lead;
  }) {
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.4;">
        <p>Hi ${params.leadName || 'there'},</p>
        <p>Thanks for reaching out. We received your inquiry.</p>
        ${
          params.bookingLink
            ? `<p><a href="${params.bookingLink}">Book a time here</a></p>`
            : `<p>Reply to this email and we will follow up shortly.</p>`
        }
        <p>Talk soon.</p>
      </div>
    `;

    this.logger.log(`Sending lead auto-reply to ${params.leadEmail}`);

    return this.sendEmail({
      to: params.leadEmail,
      subject: 'We received your inquiry',
      html,
      lead: params.lead,
    });
  }

  async sendAgentNewLeadAlert(params: {
    agentEmail: string;
    leadName: string;
    leadEmail?: string;
    leadPhone?: string;
    lead?: Lead;
  }) {
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.4;">
        <h2>New Lead</h2>
        <p><strong>Name:</strong> ${params.leadName}</p>
        <p><strong>Email:</strong> ${params.leadEmail ?? 'N/A'}</p>
        <p><strong>Phone:</strong> ${params.leadPhone ?? 'N/A'}</p>
      </div>
    `;

    this.logger.log(`Sending agent alert to ${params.agentEmail}`);

    return this.sendEmail({
      to: params.agentEmail,
      subject: `New lead: ${params.leadName}`,
      html,
      lead: params.lead,
    });
  }
}

