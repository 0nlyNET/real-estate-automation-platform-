import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(Message) private readonly messagesRepo: Repository<Message>,
  ) {}

  async overview(tenantId?: string) {
    const leadsTotal = await this.leadsRepo.count(
      tenantId ? { where: { tenantId } as any } : undefined,
    );

    const messagesTotal = await this.messagesRepo.count();

    const since = new Date();
    since.setDate(since.getDate() - 6); // inclusive range = 7 days
    since.setHours(0, 0, 0, 0);

    // Leads last 7 days
    const leadsRecent = await this.leadsRepo
      .createQueryBuilder('lead')
      .select(['lead.createdAt as createdAt'])
      .where('lead.createdAt >= :since', { since })
      .andWhere(tenantId ? 'lead.tenantId = :tenantId' : '1=1', { tenantId })
      .getRawMany();

    // Messages last 7 days
    const messagesRecent = await this.messagesRepo
      .createQueryBuilder('msg')
      .select(['msg.createdAt as createdAt'])
      .where('msg.createdAt >= :since', { since })
      .getRawMany();

    const byDayMap = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      byDayMap.set(toDateKey(d), 0);
    }

    for (const row of leadsRecent) {
      const d = new Date(row.createdAt);
      const key = toDateKey(d);
      if (byDayMap.has(key)) byDayMap.set(key, (byDayMap.get(key) || 0) + 1);
    }

    const leadsByDay = Array.from(byDayMap.entries()).map(([date, count]) => ({ date, count }));

    return {
      leadsTotal,
      leadsLast7d: leadsRecent.length,
      messagesTotal,
      messagesLast7d: messagesRecent.length,
      leadsByDay,
    };
  }
}
