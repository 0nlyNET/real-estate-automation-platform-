import { BadRequestException, Injectable } from '@nestjs/common';
import Stripe = require('stripe');
import { TenantsService } from '../tenants/tenants.service';
import { mapStripeStatusToTenantStatus } from '../tenants/stripe-billing-update';

@Injectable()
export class BillingService {
  private readonly stripe: Stripe | null;

  constructor(private readonly tenants: TenantsService) {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    this.stripe = key ? new Stripe(key) : null;
  }

  private subscriptionPeriodEnd(subscription: Stripe.Subscription) {
    const periodEnds = subscription.items.data
      .map((item) => item.current_period_end)
      .filter((value): value is number => Number.isFinite(value));
    return periodEnds.length ? new Date(Math.max(...periodEnds) * 1000) : null;
  }

  private getStripe(): Stripe {
    if (!this.stripe) {
      throw new BadRequestException(
        'Stripe is not configured (STRIPE_SECRET_KEY missing)',
      );
    }
    return this.stripe;
  }

  private getPriceId(plan: 'pro' | 'teams', interval: 'month' | 'year') {
    const map: Record<string, string | undefined> = {
      'pro:month': process.env.STRIPE_PRICE_PRO_MONTH,
      'pro:year': process.env.STRIPE_PRICE_PRO_YEAR,
      'teams:month': process.env.STRIPE_PRICE_TEAMS_MONTH,
      'teams:year': process.env.STRIPE_PRICE_TEAMS_YEAR,
    };
    const priceId = map[`${plan}:${interval}`];
    if (!priceId) {
      throw new BadRequestException(
        `Missing Stripe price id for ${plan} ${interval}`,
      );
    }
    return priceId;
  }

  async createCheckoutSession(params: {
    tenantId: string;
    userEmail: string;
    plan: 'pro' | 'teams';
    interval: 'month' | 'year';
    successUrl: string;
    cancelUrl: string;
  }) {
    const stripe = this.getStripe();

    const tenant = await this.tenants.findById(params.tenantId);
    if (!tenant) throw new BadRequestException('Tenant not found');

    let customerId = tenant.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: params.userEmail,
        metadata: { tenantId: tenant.id },
      });
      customerId = customer.id;
      await this.tenants.setStripeCustomer(tenant.id, customerId);
    }

    const priceId = this.getPriceId(params.plan, params.interval);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      allow_promotion_codes: true,
      client_reference_id: tenant.id,
      subscription_data: {
        metadata: { tenantId: tenant.id, plan: params.plan },
      },
      metadata: { tenantId: tenant.id, plan: params.plan },
    });

    if (!session.url)
      throw new BadRequestException('Stripe session missing url');
    return { url: session.url };
  }

  async createPortalSession(params: { tenantId: string; returnUrl: string }) {
    const stripe = this.getStripe();

    const tenant = await this.tenants.findById(params.tenantId);
    if (!tenant || !tenant.stripeCustomerId) {
      throw new BadRequestException('No Stripe customer found for this tenant');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: params.returnUrl,
    });

    return { url: session.url };
  }

  async handleWebhook(rawBody: Buffer, signature: string) {
    const stripe = this.getStripe();

    const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
    if (!secret) throw new BadRequestException('STRIPE_WEBHOOK_SECRET missing');
    if (!rawBody)
      throw new BadRequestException('Stripe webhook raw body is unavailable');

    const event = stripe.webhooks.constructEvent(rawBody, signature, secret);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = (
          session.metadata?.tenantId ||
          session.client_reference_id ||
          ''
        ).toString();
        const subscriptionId = (session.subscription || '').toString();
        if (tenantId && subscriptionId) {
          const subscription =
            await stripe.subscriptions.retrieve(subscriptionId);
          const plan =
            (subscription.metadata?.plan as any) ||
            (session.metadata?.plan as any) ||
            'pro';
          const currentPeriodEnd = this.subscriptionPeriodEnd(subscription);
          await this.tenants.setPlan(
            tenantId,
            plan === 'teams' ? 'teams' : 'pro',
            mapStripeStatusToTenantStatus(subscription.status),
            currentPeriodEnd,
            subscription.id,
          );
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = (sub.metadata?.tenantId || '').toString();
        if (tenantId) {
          const plan = (sub.metadata?.plan as any) || 'pro';
          const currentPeriodEnd = this.subscriptionPeriodEnd(sub);
          const deleted = event.type === 'customer.subscription.deleted';
          await this.tenants.setPlan(
            tenantId,
            deleted ? 'free' : plan === 'teams' ? 'teams' : 'pro',
            deleted ? 'canceled' : mapStripeStatusToTenantStatus(sub.status),
            currentPeriodEnd,
            deleted ? null : sub.id,
          );
        }
        break;
      }

      case 'invoice.payment_failed':
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionRef = (invoice as any).subscription;
        const subscriptionId =
          typeof subscriptionRef === 'string'
            ? subscriptionRef
            : subscriptionRef?.id;
        if (subscriptionId) {
          const subscription =
            await stripe.subscriptions.retrieve(subscriptionId);
          const tenantId = String(subscription.metadata?.tenantId || '');
          if (tenantId) {
            if (event.type === 'invoice.payment_failed')
              await this.tenants.setPastDue(tenantId);
            else await this.tenants.setActive(tenantId);
          }
        }
        break;
      }

      default:
        break;
    }

    return { received: true };
  }
}
