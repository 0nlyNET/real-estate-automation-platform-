import { BadRequestException, Injectable } from '@nestjs/common';
import Stripe = require('stripe');
import { TenantsService } from '../tenants/tenants.service';
import { mapStripeStatusToTenantStatus } from '../tenants/stripe-billing-update';

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

  constructor(private readonly tenants: TenantsService) {
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

  private subscriptionPeriod(subscription: Stripe.Subscription) {
    const starts = subscription.items.data
      .map((item) => item.current_period_start)
      .filter((value): value is number => Number.isFinite(value));
    const ends = subscription.items.data
      .map((item) => item.current_period_end)
      .filter((value): value is number => Number.isFinite(value));
    return {
      start: starts.length ? stripeDate(Math.min(...starts)) : null,
      end: ends.length ? stripeDate(Math.max(...ends)) : null,
    };
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

    const subscriptions = await this.getStripe().subscriptions.list({
      customer: tenant.stripeCustomerId,
      status: 'all',
      limit: 100,
    });

    const open = subscriptions.data
      .filter((subscription) => OPEN_SUBSCRIPTION_STATES.has(subscription.status))
      .sort((left, right) => right.created - left.created)[0];

    if (open) {
      const period = this.subscriptionPeriod(open);
      const updated = await this.tenants.updateBilling(tenant.id, {
        status: mapStripeStatusToTenantStatus(open.status),
        stripeSubscriptionId: open.id,
        stripeSubscriptionStatus: open.status,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        cancelAtPeriodEnd: Boolean(open.cancel_at_period_end),
        cancelAt: stripeDate(open.cancel_at),
        cancellationDate: null,
        canceledAt: null,
        billingStateUpdatedAt: new Date(),
      });
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
