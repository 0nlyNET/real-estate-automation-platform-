import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant, Plan, TenantStatus } from './tenant.entity';
import { mapStripeStatusToTenantStatus, toDateOrNull } from './stripe-billing-update';

@Injectable()
export class TenantsService {
  constructor(@InjectRepository(Tenant) private readonly repo: Repository<Tenant>) {}

  async listAll(): Promise<Tenant[]> {
    return await this.repo.find({ order: { createdAt: 'DESC' as any } });
  }

  async createTrialTenant(name?: string): Promise<Tenant> {
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const tenant = this.repo.create({
      name: name?.trim() || 'My Workspace',
      plan: 'trial',
      status: 'trialing',
      billingInterval: 'month',
      trialEndsAt,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: null,
      stripePriceId: null,
    });
    return await this.repo.save(tenant);
  }

  async findById(id: string): Promise<Tenant | null> {
    return await this.repo.findOne({ where: { id } });
  }

  async updateBilling(
    tenantId: string,
    patch: Partial<
      Pick<
        Tenant,
        | 'plan'
        | 'status'
        | 'trialEndsAt'
        | 'currentPeriodEnd'
        | 'cancelAtPeriodEnd'
        | 'cancelAt'
        | 'stripeCustomerId'
        | 'stripeSubscriptionId'
        | 'stripeSubscriptionStatus'
        | 'stripePriceId'
        | 'billingInterval'
      >
    >,
  ): Promise<Tenant> {
    await this.repo.update({ id: tenantId }, patch);
    const updated = await this.findById(tenantId);
    if (!updated) throw new Error('Tenant not found');
    return updated;
  }

  async setStripeCustomer(tenantId: string, stripeCustomerId: string): Promise<void> {
    await this.repo.update({ id: tenantId }, { stripeCustomerId });
  }

  async setPlan(
    tenantId: string,
    plan: Plan,
    status: TenantStatus,
    currentPeriodEnd: Date | null,
    stripeSubscriptionId?: string | null,
  ): Promise<void> {
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

  async setPastDue(tenantId: string): Promise<void> {
    await this.repo.update({ id: tenantId }, { status: 'past_due' });
  }

  async setActive(tenantId: string): Promise<void> {
    await this.repo.update({ id: tenantId }, { status: 'active' });
  }

  async updateFromStripeSubscription(
    tenantId: string,
    subscription: {
      id?: string | null;
      status?: string | null;
      current_period_end?: number | null;
      cancel_at?: number | null;
      cancel_at_period_end?: boolean | null;
    },
  ): Promise<void> {
    const stripeStatus = String(subscription.status || '');
    const status = mapStripeStatusToTenantStatus(stripeStatus);

    const currentPeriodEnd = toDateOrNull(subscription.current_period_end);
    const cancelAt = toDateOrNull(subscription.cancel_at);

    await this.repo.update(
      { id: tenantId },
      {
        stripeSubscriptionId: subscription.id || null,
        stripeSubscriptionStatus: stripeStatus || null,
        status,
        currentPeriodEnd,
        cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
        cancelAt,
      },
    );
  }
}
