import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { Lead } from '../leads/lead.entity';
import { Message } from '../messaging/message.entity';
import { Credential } from '../settings/credential.entity';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Tenant) private readonly tenantsRepo: Repository<Tenant>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(Message) private readonly messagesRepo: Repository<Message>,
    @InjectRepository(Credential) private readonly credentialsRepo: Repository<Credential>,
  ) {}

  async listTenants(): Promise<Tenant[]> {
    return this.tenantsRepo.find({ order: { createdAt: 'DESC' as any } });
  }

  async listUsersByTenant(tenantId: string): Promise<User[]> {
    return this.usersRepo.find({
      where: { tenantId } as any,
      order: { email: 'ASC' as any },
    });
  }

  async findUserById(id: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { id } as any });
  }

  async overview() {
    const tenants = await this.tenantsRepo.find();

    const totalClients = tenants.length;
    const active = tenants.filter((t: any) => String(t.status).toLowerCase() === 'active').length;
    const trialing = tenants.filter((t: any) => String(t.status).toLowerCase() === 'trialing').length;
    const pastDue = tenants.filter((t: any) => String(t.status).toLowerCase() === 'past_due').length;
    const canceled = tenants.filter((t: any) => String(t.status).toLowerCase() === 'canceled').length;

    // Placeholder estimate until you wire Stripe amounts per tenant.
    const monthlyRevenueEstimate = active * 1000;

    return { totalClients, active, trialing, pastDue, canceled, monthlyRevenueEstimate };
  }

  async systemHealth() {
    const now = Date.now();
    const sinceMs = now - 24 * 60 * 60 * 1000;
    const since = new Date(sinceMs);

    // These fields may differ in your Message entity. We handle common cases safely.
    const totalMessages24h = await this.messagesRepo
      .createQueryBuilder('m')
      .where('m.createdAt >= :since', { since })
      .getCount();

    let failedMessages24h = 0;
    try {
      failedMessages24h = await this.messagesRepo
        .createQueryBuilder('m')
        .where('m.createdAt >= :since', { since })
        .andWhere('(m.status = :failed OR m.deliveryStatus = :failed)', { failed: 'failed' })
        .getCount();
    } catch {
      // If status fields do not exist, keep 0 until we map correctly.
      failedMessages24h = 0;
    }

    const errorRate = totalMessages24h === 0 ? 0 : Number((failedMessages24h / totalMessages24h).toFixed(3));

    // Basic DB connectivity signal: if this query works, DB is up.
    const dbConnected = true;

    // Placeholders until you add explicit provider error tracking
    const twilioErrorRate = errorRate;
    const sendgridErrorRate = errorRate;

    // API calls tracking is not implemented yet. Add middleware logging later.
    const totalApiCalls24h = 0;

    return {
      totalApiCalls24h,
      totalMessages24h,
      failedMessages24h,
      twilioErrorRate,
      sendgridErrorRate,
      dbConnected,
    };
  }
}
