import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant, Plan } from './tenant.entity';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant) private readonly repo: Repository<Tenant>,
  ) {}

  async createTrialTenant(name?: string): Promise<Tenant> {
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const tenant = this.repo.create({
      name: name?.trim() || 'My Workspace',
      plan: 'trial',
      status: 'trialing',
      trialEndsAt,
      currentPeriodEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    });
    return await this.repo.save(tenant);
  }

  async findById(id: string): Promise<Tenant | null> {
    return await this.repo.findOne({ where: { id } });
  }

  async updateBilling(tenantId: string, patch: Partial<Pick<Tenant, 'plan' | 'status' | 'trialEndsAt' | 'currentPeriodEnd' | 'stripeCustomerId' | 'stripeSubscriptionId'>>): Promise<Tenant> {
    await this.repo.update({ id: tenantId }, patch);
    const updated = await this.findById(tenantId);
    if (!updated) throw new Error('Tenant not found');
    return updated;
  }

  async setStripeCustomer(tenantId: string, stripeCustomerId: string): Promise<void> {
    await this.repo.update({ id: tenantId }, { stripeCustomerId });
  }

  async setPlan(tenantId: string, plan: Plan, status: string, currentPeriodEnd: Date | null, stripeSubscriptionId?: string | null): Promise<void> {
    await this.repo.update(
      { id: tenantId },
      {
        plan,
        status,
        currentPeriodEnd,
        trialEndsAt: null,
        stripeSubscriptionId: stripeSubscriptionId ?? null,
      },
    );
  }
}
