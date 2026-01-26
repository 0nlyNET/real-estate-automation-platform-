import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoutingRule } from './routing-rule.entity';
import { RoutingAssignmentLog } from './routing-assignment-log.entity';

@Injectable()
export class RoutingService {
  constructor(
    @InjectRepository(RoutingRule)
    private readonly rulesRepo: Repository<RoutingRule>,
    @InjectRepository(RoutingAssignmentLog)
    private readonly logRepo: Repository<RoutingAssignmentLog>,
  ) {}

  async listRules(tenantId: string) {
    return this.rulesRepo.find({
      where: { tenantId } as any,
      order: { priority: 'ASC', createdAt: 'ASC' } as any,
    });
  }

  async upsertRule(tenantId: string, payload: any) {
    const rule = this.rulesRepo.create({
      id: payload.id,
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
      ok('type', conditions.type) &&
      ok('location', conditions.location) &&
      ok('stage', conditions.stage)
    );
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
