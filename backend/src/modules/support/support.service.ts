import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportTicket } from './support-ticket.entity';
import { MailService } from '../../mail/mail.service';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportTicket)
    private readonly repo: Repository<SupportTicket>,
    private readonly mail: MailService,
  ) {}

  async createTicket(params: {
    tenantId: string;
    userId: string;
    email: string;
    name?: string | null;
    subject: string;
    message: string;
  }) {
    const ticket = this.repo.create({
      tenant: { id: params.tenantId } as any,
      userId: params.userId,
      email: params.email,
      name: params.name || null,
      subject: params.subject.trim(),
      message: params.message.trim(),
      status: 'open',
    });

    const saved = await this.repo.save(ticket);
    const inbox = String(process.env.SALES_INBOX_EMAIL || '').trim();
    let notificationSent = false;
    if (inbox) {
      try {
        await this.mail.sendEmail({
          to: inbox,
          subject: `[RealtyTechAI support] ${saved.subject}`,
          text:
            `Ticket: ${saved.id}\n` +
            `Workspace: ${params.tenantId}\n` +
            `User: ${params.email}\n\n` +
            `${saved.message}`,
        });
        notificationSent = true;
      } catch (error: unknown) {
        this.logger.warn(
          `Support ticket ${saved.id} saved but notification failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else {
      this.logger.warn(
        `Support ticket ${saved.id} saved without notification: SALES_INBOX_EMAIL is not configured`,
      );
    }

    return { ok: true, ticketId: saved.id, notificationSent };
  }
}
