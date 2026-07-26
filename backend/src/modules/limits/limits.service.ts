import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';

export type LimitCheckResult =
  | { ok: true }
  | { ok: false; code: 'PLAN_BLOCKED' | 'LIMIT_LEADS'; message: string };

@Injectable()
export class LimitsService {
  constructor(
    @InjectRepository(Tenant) private readonly tenantsRepo: Repository<Tenant>,
  ) {}

  async canCreateLead(tenantId: string): Promise<LimitCheckResult> {
    const tenant = await this.tenantsRepo.findOne({ where: { id: tenantId } });
    if (!tenant) return { ok: false, code: 'PLAN_BLOCKED', message: 'Tenant not found' };

    if (tenant.status === 'canceled' || tenant.status === 'unpaid' || tenant.status === 'paused') {
      return { ok: false, code: 'PLAN_BLOCKED', message: 'Your subscription is not active. Update billing to continue.' };
    }

    return { ok: true };
  }
}
