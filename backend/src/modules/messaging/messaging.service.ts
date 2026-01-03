import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from './message.entity';

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
  ) {}

  async createMessage(data: Partial<Message>) {
    const message = this.messageRepository.create(data);
    await this.messageRepository.save(message);

    // TODO: Re-enable async delivery (email/SMS/WhatsApp) when Redis + queues are added back.
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