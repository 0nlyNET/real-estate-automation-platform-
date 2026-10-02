import { BadRequestException, Injectable } from '@nestjs/common';
import Stripe = require('stripe');
import { TenantsService } from '../tenants/tenants.service';
import { BillingService } from './billing.service';

const OPEN_SUBSCRIPTION_STATES = new Set([
  'active',
  'trialing',
  'paused',
  'incomplete',
  'past_due',
  'unpaid',
]);

function stripeDate(seconds?: number | null) {
  return seconds ? new Date(seconds * 1000) : null;
}

@Injectable()
export class BillingReconciliationService {
  private readonly stripe: Stripe | null;

  constructor(private readonly tenants: TenantsService, private readonly billing: BillingService) {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    this.stripe = key ? new Stripe(key) : null;
  }

  private getStripe(): Stripe {
    if (!this.stripe) {
      throw new BadRequestException(
        'Stripe is not configured (STRIPE_SECRET_KEY missing)',
      );
    }
    return this.stripe;
  }

  async reconcileTenant(tenantId: string) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new BadRequestException('Tenant not found');

    if (!tenant.stripeCustomerId) {
      // Metadata fallback: the customer mapping may be missing (e.g. the
      // subscription was created before the mapping was stored, or the
      // webhook created it via metadata). Search Stripe for a subscription
      // carrying this tenant's ID in metadata before giving up.
      const byMetadata = await this.findSubscriptionByTenantMetadata(tenantId);
      if (!byMetadata) {
        return {
          reconciled: false,
          status: tenant.status,
          stripeSubscriptionStatus: tenant.stripeSubscriptionStatus,
        };
      }
      await this.billing.reconcileSubscription(byMetadata, tenant.id);
      const updated = await this.tenants.findById(tenant.id);
      if (!updated) throw new BadRequestException('Tenant not found');
      return {
        reconciled: true,
        status: updated.status,
        stripeSubscriptionStatus: updated.stripeSubscriptionStatus,
      };
    }

    return this.billing.withCustomerLock(tenant.stripeCustomerId, async () => this.reconcileCustomer(tenantId));
  }

  private async findSubscriptionByTenantMetadata(tenantId: string): Promise<Stripe.Subscription | null> {
    // Stripe has no metadata search on subscriptions.list; page recent
    // subscriptions and match metadata.tenantId. Bounded to avoid runaway
    // scans on large accounts.
    let startingAfter: string | undefined;
    for (let page = 0; page < 10; page++) {
      const subscriptions = await this.getStripe().subscriptions.list({
        status: 'all',
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      const match = subscriptions.data.find(
        (subscription) => String(subscription.metadata?.tenantId || '').trim() === tenantId,
      );
      if (match) return match;
      if (!subscriptions.has_more) break;
      startingAfter = subscriptions.data[subscriptions.data.length - 1]?.id;
    }
    return null;
  }

  private async reconcileCustomer(tenantId: string) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant?.stripeCustomerId) throw new BadRequestException('Stripe customer is not configured');

    const subscriptions = await this.getStripe().subscriptions.list({
      customer: tenant.stripeCustomerId,
      status: 'all',
      limit: 100,
    });

    const open = subscriptions.data
      .filter((subscription) => OPEN_SUBSCRIPTION_STATES.has(subscription.status))
      .sort((left, right) => right.created - left.created)[0];

    if (open) {
      await this.billing.reconcileSubscription(open, tenant.id);
      const updated = await this.tenants.findById(tenant.id);
      if (!updated) throw new BadRequestException('Tenant not found');
      return {
        reconciled: true,
        status: updated.status,
        stripeSubscriptionStatus: updated.stripeSubscriptionStatus,
      };
    }

    const localLooksOpen = OPEN_SUBSCRIPTION_STATES.has(
      String(tenant.stripeSubscriptionStatus || tenant.status),
    );
    if (!tenant.stripeSubscriptionId && !localLooksOpen) {
      return {
        reconciled: false,
        status: tenant.status,
        stripeSubscriptionStatus: tenant.stripeSubscriptionStatus,
      };
    }

    const latestKnown =
      subscriptions.data.find(
        (subscription) => subscription.id === tenant.stripeSubscriptionId,
      ) || subscriptions.data.sort((left, right) => right.created - left.created)[0] || null;
    const canceledAt = stripeDate(
      latestKnown?.canceled_at ||
        ((latestKnown as Stripe.Subscription & { ended_at?: number | null })?.ended_at ?? null),
    );
    const updated = await this.tenants.updateBilling(tenant.id, {
      status: 'canceled',
      stripeSubscriptionStatus: 'canceled',
      cancelAtPeriodEnd: false,
      cancelAt: null,
      cancellationDate: canceledAt || new Date(),
      canceledAt: canceledAt || new Date(),
      stripeCheckoutSessionId: null,
      stripeCheckoutStartedAt: null,
      billingStateUpdatedAt: new Date(),
    });

    return {
      reconciled: true,
      status: updated.status,
      stripeSubscriptionStatus: updated.stripeSubscriptionStatus,
    };
  }
}
