import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentPresence, PresenceStatus } from './agent-presence.entity';

@Injectable()
export class PresenceService {
  constructor(
    @InjectRepository(AgentPresence)
    private readonly repo: Repository<AgentPresence>,
  ) {}

  async heartbeat(tenantId: string, userId: string, status?: PresenceStatus) {
    const existing = await this.repo.findOne({ where: { tenantId, userId } });
    if (!existing) {
      const created = this.repo.create({
        tenantId,
        userId,
        status: status || 'online',
        lastSeenAt: new Date(),
      });
      return this.repo.save(created);
    }

    existing.lastSeenAt = new Date();
    if (status) existing.status = status;
    return this.repo.save(existing);
  }

  async setStatus(tenantId: string, userId: string, status: PresenceStatus) {
    return this.heartbeat(tenantId, userId, status);
  }

  async getOnlineUserIds(tenantId: string, userIds: string[]) {
    if (userIds.length === 0) return [];
    const rows = await this.repo.find({ where: { tenantId } as any });

    const online = new Set(
      rows
        .filter((r) => r.status === 'online' && r.lastSeenAt)
        .filter((r) => {
          const ageMs = Date.now() - new Date(r.lastSeenAt as any).getTime();
          return ageMs <= 5 * 60 * 1000;
        })
        .map((r) => r.userId),
    );

    return userIds.filter((id) => online.has(id));
  }
}
