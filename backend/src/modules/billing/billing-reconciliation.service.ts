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
      return {
        reconciled: false,
        status: tenant.status,
        stripeSubscriptionStatus: tenant.stripeSubscriptionStatus,
      };
    }

    return this.billing.withCustomerLock(tenant.stripeCustomerId, async () => this.reconcileCustomer(tenantId));
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
