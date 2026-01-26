import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportTicket } from './support-ticket.entity';

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportTicket)
    private readonly repo: Repository<SupportTicket>,
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

    await this.repo.save(ticket);
    return { ok: true };
  }
}
