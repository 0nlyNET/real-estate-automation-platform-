import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from './message.entity';
import { Lead } from '../leads/lead.entity';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {}

  /**
   * NO-OP for Railway demo
   * Previously queued instant responses via Redis/BullMQ
   */
  async queueInstantResponses(_lead: Lead): Promise<void> {
    this.logger.warn(
      '[NO-OP] queueInstantResponses called (Redis disabled)',
    );
    return;
  }

  /**
   * NO-OP auto-reply for demo
   * Keeps controller + API stable
   */
  async sendLeadAutoReply(payload: {
    leadId?: string;
    leadEmail?: string;
    leadName?: string;
    bookingLink?: string;
    message?: string;
  }): Promise<{ status: 'ok' }> {
    const msg = payload.message ?? '(no message provided)';

    this.logger.warn(
      `[NO-OP] sendLeadAutoReply called leadId=${payload.leadId ?? 'n/a'} leadEmail=${payload.leadEmail ?? 'n/a'} leadName=${payload.leadName ?? 'n/a'} bookingLink=${payload.bookingLink ?? 'n/a'} message=${msg}`,
    );

    return { status: 'ok' };
  }
  async createMessage(data: Partial<Message>) {
    const message = this.messageRepository.create(data);
    await this.messageRepository.save(message);

    this.logger.log(`Message created (id=${message.id})`);
    return message;
  }

  async getMessagesForLead(leadId: string) {
    return this.messageRepository.find({
      where: { lead: { id: leadId } },
      order: { createdAt: 'DESC' },
    });
  }
}