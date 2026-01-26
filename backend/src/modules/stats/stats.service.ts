import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { User } from '../users/user.entity';

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
  ) {}


  async overview(tenantId: string, ctx?: { userId?: string; role?: string }) {
    const leadsTotal = await this.leads.count({ where: { tenantId } as any });

    const messagesTotal = await this.messages
      .createQueryBuilder('m')
      .leftJoin('m.lead', 'l')
      .where('l.tenantId = :t', { t: tenantId })
      .getCount();

    // Avg first response time across leads that have it
    const rtRows = await this.leads
      .createQueryBuilder('l')
      .select('AVG(l.firstResponseTimeSec)', 'avg')
      .addSelect('COUNT(*)', 'count')
      .where('l.tenantId = :t', { t: tenantId })
      .andWhere('l.firstResponseTimeSec IS NOT NULL')
      .getRawOne();

    const avgFirstResponseSec = rtRows?.avg ? Math.round(Number(rtRows.avg)) : null;
    const responseSamples = rtRows?.count ? Number(rtRows.count) : 0;

    // % contacted within 5 minutes (createdAt -> firstContactSentAt)
    const contacted5 = await this.leads
      .createQueryBuilder('l')
      .where('l.tenantId = :t', { t: tenantId })
      .andWhere('l.firstContactSentAt IS NOT NULL')
      .andWhere("EXTRACT(EPOCH FROM (l.firstContactSentAt - l.createdAt)) <= 300")
      .getCount();

    const contactedSample = await this.leads
      .createQueryBuilder('l')
      .where('l.tenantId = :t', { t: tenantId })
      .andWhere('l.firstContactSentAt IS NOT NULL')
      .getCount();

    const pctContactedWithin5Min =
      contactedSample > 0 ? Math.round((contacted5 / contactedSample) * 100) : null;

    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const appointmentsSet7d = await this.leads
      .createQueryBuilder('l')
      .where('l.tenantId = :t', { t: tenantId })
      .andWhere("l.stage = 'appointment_set'")
      .andWhere('l.updatedAt >= :since', { since: since7 })
      .getCount();

    return {
      leadsTotal,
      messagesTotal,
      avgFirstResponseSec,
      responseSamples,
      pctContactedWithin5Min,
      appointmentsSet7d,
    };
  }

  async agentPerformance(tenantId: string) {
    const agents = await this.users.find({ where: { tenant: { id: tenantId }, isActive: true } as any });
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const out = [] as any[];
    for (const u of agents) {
      const leadsAssigned = await this.leads.count({ where: { tenantId, assignedToUserId: u.id } as any });
      const leadsNew7d = await this.leads
        .createQueryBuilder('l')
        .where('l.tenantId = :t', { t: tenantId })
        .andWhere('l.assignedToUserId = :u', { u: u.id })
        .andWhere('l.createdAt >= :since', { since: since7.toISOString() })
        .getCount();

      const messagesSent7d = await this.messages
        .createQueryBuilder('m')
        .leftJoin('m.lead', 'l')
        .where('l.tenantId = :t', { t: tenantId })
        .andWhere('m.direction = :d', { d: 'outbound' })
        .andWhere('m.createdAt >= :since', { since: since7.toISOString() })
        .andWhere('l.assignedToUserId = :u', { u: u.id })
        .getCount();

      out.push({
        userId: u.id,
        email: u.email,
        role: u.role,
        teamId: u.teamId,
        leadsAssigned,
        leadsNew7d,
        messagesSent7d,
      });
    }
    return out;
  }

  // Backwards-compatible name used by the controller.
  async agentMetrics(tenantId: string) {
    return await this.agentPerformance(tenantId);
  }
}
