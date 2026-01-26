import { BadRequestException, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { TenantsService } from '../tenants/tenants.service';

@Injectable()
export class BillingService {
  private stripe: Stripe;

  constructor(private readonly tenants: TenantsService) {
    const key = process.env.STRIPE_SECRET_KEY || '';
    this.stripe = new Stripe(key, { apiVersion: '2024-06-20' as any });
  }

  private requireStripe() {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new BadRequestException('Stripe is not configured (STRIPE_SECRET_KEY missing)');
    }
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
      throw new BadRequestException(`Missing Stripe price id for ${plan} ${interval}`);
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
    this.requireStripe();

    const tenant = await this.tenants.findById(params.tenantId);
    if (!tenant) throw new BadRequestException('Tenant not found');

    let customerId = tenant.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        email: params.userEmail,
        metadata: { tenantId: tenant.id },
      });
      customerId = customer.id;
      await this.tenants.setStripeCustomer(tenant.id, customerId);
    }

    const priceId = this.getPriceId(params.plan, params.interval);

    const session = await this.stripe.checkout.sessions.create({
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

    if (!session.url) throw new BadRequestException('Stripe session missing url');
    return { url: session.url };
  }

  async createPortalSession(params: { tenantId: string; returnUrl: string }) {
    this.requireStripe();

    const tenant = await this.tenants.findById(params.tenantId);
    if (!tenant || !tenant.stripeCustomerId) {
      throw new BadRequestException('No Stripe customer found for this tenant');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: params.returnUrl,
    });

    return { url: session.url };
  }

  async handleWebhook(rawBody: Buffer, signature: string) {
    this.requireStripe();

    const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
    if (!secret) throw new BadRequestException('STRIPE_WEBHOOK_SECRET missing');

    const event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);

    console.log("[stripe] event:", event.type);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = (session.metadata?.tenantId || session.client_reference_id || '').toString();
        const subscriptionId = (session.subscription || '').toString();
        if (tenantId && subscriptionId) {
          const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
          const plan = (subscription.metadata?.plan as any) || (session.metadata?.plan as any) || 'pro';
          const currentPeriodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null;
          await this.tenants.setPlan(tenantId, plan === 'teams' ? 'teams' : 'pro', subscription.status, currentPeriodEnd, subscription.id);
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = (sub.metadata?.tenantId || '').toString();
        if (tenantId) {
          const plan = (sub.metadata?.plan as any) || 'pro';
          const currentPeriodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
          const status = sub.status;
          await this.tenants.setPlan(tenantId, plan === 'teams' ? 'teams' : 'pro', status, currentPeriodEnd, sub.id);
        }
        break;
      }

      default:
        break;
    }

    return { received: true };
  }
}
