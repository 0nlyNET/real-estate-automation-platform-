import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../leads/lead.entity';
import { Tenant } from '../tenants/tenant.entity';

export type LimitCheckResult =
  | { ok: true }
  | { ok: false; code: 'PLAN_BLOCKED' | 'LIMIT_LEADS'; message: string };

function leadLimitForPlan(plan: string): number {
  // MVP limits (adjust later)
  if (plan === 'trial') return 100;
  if (plan === 'free') return 50;
  if (plan === 'pro') return 1000;
  if (plan === 'teams') return 5000;
  return 999999;
}

@Injectable()
export class LimitsService {
  constructor(
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(Tenant) private readonly tenantsRepo: Repository<Tenant>,
  ) {}

  async canCreateLead(tenantId: string): Promise<LimitCheckResult> {
    const tenant = await this.tenantsRepo.findOne({ where: { id: tenantId } });
    if (!tenant) return { ok: false, code: 'PLAN_BLOCKED', message: 'Tenant not found' };

    if (tenant.status === 'canceled' || tenant.status === 'unpaid' || tenant.status === 'paused') {
      return { ok: false, code: 'PLAN_BLOCKED', message: 'Your subscription is not active. Update billing to continue.' };
    }

    const limit = leadLimitForPlan(tenant.plan);
    const count = await this.leadsRepo.count({ where: { tenantId } });

    if (count >= limit) {
      return {
        ok: false,
        code: 'LIMIT_LEADS',
        message: `Lead limit reached for your plan (${limit}). Upgrade to add more leads.`,
      };
    }

    return { ok: true };
  }
}
