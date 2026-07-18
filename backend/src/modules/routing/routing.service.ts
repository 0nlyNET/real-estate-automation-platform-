import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoutingRule } from './routing-rule.entity';
import { RoutingAssignmentLog } from './routing-assignment-log.entity';
import { User } from '../users/user.entity';
import { Lead } from '../leads/lead.entity';
import { Team } from '../teams/team.entity';
import { PresenceService } from '../presence/presence.service';

@Injectable()
export class RoutingService {
  constructor(
    @InjectRepository(RoutingRule)
    private readonly rulesRepo: Repository<RoutingRule>,
    @InjectRepository(RoutingAssignmentLog)
    private readonly logRepo: Repository<RoutingAssignmentLog>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Lead) private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Team) private readonly teamRepo: Repository<Team>,
    private readonly presence: PresenceService,
  ) {}

  async listRules(tenantId: string) {
    return this.rulesRepo.find({
      where: { tenantId } as any,
      order: { priority: 'ASC', createdAt: 'ASC' } as any,
    });
  }

  async upsertRule(tenantId: string, payload: any) {
    if (!tenantId) throw new BadRequestException('Missing tenant');
    const existing = payload.id
      ? await this.rulesRepo.findOne({ where: { id: payload.id, tenantId } as any })
      : null;
    if (payload.id && !existing) throw new BadRequestException('Routing rule not found');

    const rule = this.rulesRepo.create({
      id: existing?.id,
      tenantId,
      name: payload.name || 'Rule',
      isActive: payload.isActive ?? true,
      priority: payload.priority ?? 100,
      conditions: payload.conditions || {},
      actionType: payload.actionType,
      actionConfig: payload.actionConfig || {},
    });
    return this.rulesRepo.save(rule);
  }

  async deleteRule(tenantId: string, id: string) {
    await this.rulesRepo.delete({ tenantId, id } as any);
    return { ok: true };
  }

  matchesConditions(lead: any, conditions: any) {
    if (!conditions) return true;
    const ok = (k: string, v: any) => {
      if (v === undefined || v === null || v === '') return true;
      return (
        String((lead as any)[k] || '').toLowerCase() ===
        String(v).toLowerCase()
      );
    };
    return (
      ok('source', conditions.source) &&
      ok('leadType', conditions.type) &&
      ok('location', conditions.location) &&
      ok('stage', conditions.stage)
    );
  }

  async routeLead(lead: Lead) {
    const rules = await this.rulesRepo.find({
      where: { tenantId: lead.tenantId, isActive: true } as any,
      order: { priority: 'ASC', createdAt: 'ASC' } as any,
    });

    for (const rule of rules) {
      if (!this.matchesConditions(lead, rule.conditions)) continue;
      const config = rule.actionConfig || {};

      if (rule.actionType === 'fixed_user') {
        const userId = String(config.userId || '');
        const user = userId
          ? await this.userRepo.findOne({ where: { id: userId, tenantId: lead.tenantId, isActive: true } })
          : null;
        if (!user) continue;
        if (config.requireOnline) {
          const online = await this.presence.getOnlineUserIds(lead.tenantId, [user.id]);
          if (!online.includes(user.id)) continue;
        }
        const result = { assignedToUserId: user.id, assignedToTeamId: user.teamId, assignedToLabel: user.email, ruleId: rule.id };
        await this.logDecision(lead.tenantId, lead.id, 'fixed_user', config, rule.id, user.id, user.teamId);
        return result;
      }

      if (rule.actionType === 'round_robin_team') {
        const teamId = String(config.teamId || '');
        const team = teamId ? await this.teamRepo.findOne({ where: { id: teamId, tenantId: lead.tenantId } }) : null;
        if (!team) continue;
        let users = await this.userRepo.find({ where: { tenantId: lead.tenantId, teamId, isActive: true } });
        users = users.filter((user) => ['owner', 'admin', 'agent', 'tc'].includes(user.role));
        if (config.requireOnline) {
          const online = new Set(await this.presence.getOnlineUserIds(lead.tenantId, users.map((user) => user.id)));
          users = users.filter((user) => online.has(user.id));
        }
        if (!users.length) continue;

        const counts = await Promise.all(
          users.map(async (user) => ({ user, count: await this.leadRepo.count({ where: { tenantId: lead.tenantId, assignedToUserId: user.id } }) })),
        );
        counts.sort((a, b) => a.count - b.count || a.user.id.localeCompare(b.user.id));
        const selected = counts[0].user;
        const result = { assignedToUserId: selected.id, assignedToTeamId: team.id, assignedToLabel: selected.email, ruleId: rule.id };
        await this.logDecision(lead.tenantId, lead.id, 'round_robin_team', config, rule.id, selected.id, team.id);
        return result;
      }
    }

    await this.logDecision(lead.tenantId, lead.id, 'no_matching_rule');
    return null;
  }

  async logDecision(
    tenantId: string,
    leadId: string,
    decision: string,
    meta?: any,
    ruleId?: string | null,
    assignedToUserId?: string | null,
    assignedToTeamId?: string | null,
  ) {
    const row = this.logRepo.create({
      tenantId,
      leadId,
      decision,
      meta: meta || null,
      ruleId: ruleId || null,
      assignedToUserId: assignedToUserId || null,
      assignedToTeamId: assignedToTeamId || null,
    });
    return this.logRepo.save(row);
  }
}
