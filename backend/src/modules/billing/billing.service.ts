import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Stripe = require('stripe');
import * as crypto from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { TenantsService } from '../tenants/tenants.service';
import { Tenant } from '../tenants/tenant.entity';
import { TenantSettings } from '../settings/tenant-settings.entity';
import { mapStripeStatusToTenantStatus } from '../tenants/stripe-billing-update';
import { StripeWebhookEvent } from './stripe-webhook-event.entity';
import {
  ServiceBillingInterval,
  requireConfiguredServicePriceId,
  requireConfiguredSetupPriceId,
  planForStripePrice,
} from './stripe-plan-config';
import { OperationsService } from '../operations/operations.service';
import { operationalEvent } from '../../common/operational-log';
import { BillingEvent } from './billing-event.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { configuredBillingGraceDays } from '../entitlements/entitlement.service';
import { ServiceControlService } from '../service-control/service-control.service';

const OPEN_SUBSCRIPTION_STATES = new Set([
  'active',
  'trialing',
  'paused',
  'incomplete',
  'past_due',
  'unpaid',
]);
const CHECKOUT_PENDING_MS = 30 * 60 * 1000;

function stripeDate(seconds?: number | null) {
  return seconds ? new Date(seconds * 1000) : null;
}

function sanitizedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/sk_(?:live|test)_[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 1000);
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripe: Stripe | null;

  constructor(
    private readonly tenants: TenantsService,
    @Optional()
    @InjectRepository(StripeWebhookEvent)
    private readonly events?: Repository<StripeWebhookEvent>,
    @Optional()
    @InjectRepository(Tenant)
    private readonly tenantRepo?: Repository<Tenant>,
    @Optional()
    @InjectRepository(TenantSettings)
    private readonly settingsRepo?: Repository<TenantSettings>,
    @Optional()
    @InjectDataSource()
    private readonly dataSource?: DataSource,
    @Optional()
    private readonly operations?: OperationsService,
    @Optional()
    @InjectRepository(BillingEvent)
    private readonly billingEvents?: Repository<BillingEvent>,
    @Optional()
    private readonly notifications?: NotificationsService,
    @Optional()
    private readonly serviceControl?: ServiceControlService,
  ) {
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

  private subscriptionPrice(subscription: Stripe.Subscription) {
    const item = subscription.items.data[0];
    const priceId = item?.price?.id || null;
    const product = item?.price?.product;
    const productId =
      typeof product === 'string' ? product : product && 'id' in product ? product.id : null;
    return {
      priceId,
      productId,
      unitAmount: item?.price?.unit_amount ?? null,
      currency: item?.price?.currency || null,
      interval: item?.price?.recurring?.interval === 'year' ? 'year' as const : 'month' as const,
    };
  }

  private async withCheckoutLock<T>(tenantId: string, callback: () => Promise<T>) {
    if (!this.dataSource) return callback();
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `stripe-checkout:${tenantId}`,
      ]);
      return callback();
    });
  }

  async createCheckoutSession(params: {
    tenantId: string;
    userEmail: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    const stripe = this.getStripe();
    return this.withCheckoutLock(params.tenantId, async () => {
      let tenant = await this.tenants.findById(params.tenantId);
      if (!tenant) throw new BadRequestException('Tenant not found');

      const recentCheckout =
        tenant.stripeCheckoutSessionId &&
        tenant.stripeCheckoutStartedAt &&
        Date.now() - tenant.stripeCheckoutStartedAt.getTime() < CHECKOUT_PENDING_MS;
      if (
        recentCheckout ||
        (tenant.stripeSubscriptionId &&
          OPEN_SUBSCRIPTION_STATES.has(
            String(tenant.stripeSubscriptionStatus || tenant.status),
          ))
      ) {
        throw new ConflictException({
          code: 'SUBSCRIPTION_EXISTS',
          message:
            'This workspace already has a subscription or checkout in progress. Open billing management instead.',
          action: 'open_billing_portal',
        });
      }

      let customerId = tenant.stripeCustomerId;
      if (customerId) {
        const subscriptions = await stripe.subscriptions.list({
          customer: customerId,
          status: 'all',
          limit: 10,
        });
        const open = subscriptions.data.find((subscription) =>
          OPEN_SUBSCRIPTION_STATES.has(subscription.status),
        );
        if (open) {
          await this.tenants.updateBilling(tenant.id, {
            stripeSubscriptionId: open.id,
            stripeSubscriptionStatus: open.status,
            status: mapStripeStatusToTenantStatus(open.status),
            billingStateUpdatedAt: new Date(),
          });
          throw new ConflictException({
            code: 'SUBSCRIPTION_EXISTS',
            message:
              'Stripe already has a subscription for this workspace. Open billing management instead.',
            action: 'open_billing_portal',
          });
        }
      } else {
        const customer = await stripe.customers.create(
          {
            email: params.userEmail,
            metadata: { tenantId: tenant.id },
          },
          { idempotencyKey: `customer:${tenant.id}` },
        );
        customerId = customer.id;
        await this.tenants.setStripeCustomer(tenant.id, customerId);
        tenant = (await this.tenants.findById(tenant.id)) || tenant;
      }

      const servicePriceId = requireConfiguredServicePriceId();
      const setupFeeIncluded = !tenant.setupPaidAt;
      const setupPriceId = setupFeeIncluded
        ? requireConfiguredSetupPriceId()
        : null;
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
        { price: servicePriceId, quantity: 1 },
      ];
      if (setupPriceId) {
        lineItems.push({ price: setupPriceId, quantity: 1 });
      }
      const checkoutMetadata: Record<string, string> = {
        tenantId: tenant.id,
        setupFeeIncluded: String(setupFeeIncluded),
      };
      if (setupPriceId) checkoutMetadata.setupPriceId = setupPriceId;

      await this.tenants.updateBilling(tenant.id, {
        stripeCheckoutSessionId: 'creating',
        stripeCheckoutStartedAt: new Date(),
        status: 'incomplete',
        billingStateUpdatedAt: new Date(),
      });

      try {
        const session = await stripe.checkout.sessions.create(
          {
            mode: 'subscription',
            customer: customerId,
            line_items: lineItems,
            success_url: params.successUrl,
            cancel_url: params.cancelUrl,
            allow_promotion_codes: true,
            client_reference_id: tenant.id,
            subscription_data: { metadata: checkoutMetadata },
            metadata: checkoutMetadata,
          },
          { idempotencyKey: `checkout:${tenant.id}:${crypto.randomUUID()}` },
        );
        if (!session.url)
          throw new BadRequestException('Stripe session missing url');
        await this.tenants.updateBilling(tenant.id, {
          stripeCheckoutSessionId: session.id,
          stripeCheckoutStartedAt: new Date(),
        });
        return { url: session.url };
      } catch (error) {
        await this.tenants.updateBilling(tenant.id, {
          stripeCheckoutSessionId: null,
          stripeCheckoutStartedAt: null,
        });
        throw error;
      }
    });
  }

  async createPortalSession(params: { tenantId: string; returnUrl: string }) {
    const stripe = this.getStripe();
    const tenant = await this.tenants.findById(params.tenantId);
    if (!tenant?.stripeCustomerId) {
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
    if (!signature) throw new BadRequestException('Stripe signature is missing');

    // Verification always happens before the event ledger is touched.
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (error) {
      this.logger.warn(
        operationalEvent('invalid_webhook_signature', {
          provider: 'stripe',
          error: sanitizedError(error),
        }),
      );
      throw error;
    }
    return this.processVerifiedEvent(event);
  }

  private async claimEvent(event: Stripe.Event) {
    if (!this.events) return { process: true, row: null as StripeWebhookEvent | null };
    try {
      const row = await this.events.save(
        this.events.create({
          stripeEventId: event.id,
          eventType: event.type,
          apiVersion: event.api_version || null,
          stripeCreatedAt: stripeDate(event.created),
          processingStatus: 'processing',
          processingStartedAt: new Date(),
        }),
      );
      return { process: true, row };
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      const existing = await this.events.findOne({
        where: { stripeEventId: event.id },
      });
      if (!existing) throw error;
      if (existing.processingStatus === 'completed')
        return { process: false, row: existing };
      if (
        existing.processingStatus === 'processing' &&
        existing.processingStartedAt &&
        Date.now() - existing.processingStartedAt.getTime() < 5 * 60 * 1000
      ) {
        return { process: false, row: existing };
      }
      existing.processingStatus = 'processing';
      existing.processingStartedAt = new Date();
      existing.errorSummary = null;
      return { process: true, row: await this.events.save(existing) };
    }
  }

  private async processVerifiedEvent(event: Stripe.Event) {
    const claim = await this.claimEvent(event);
    if (!claim.process) return { received: true, duplicate: true };

    try {
      let tenantId: string | null = null;
      let customerId: string | null = null;
      let subscriptionId: string | null = null;

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        tenantId = String(
          session.metadata?.tenantId || session.client_reference_id || '',
        ) || null;
        customerId =
          typeof session.customer === 'string' ? session.customer : session.customer?.id || null;
        subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id || null;
        if (!tenantId || !subscriptionId)
          throw new Error('Checkout event is missing tenant or subscription');
        const subscription = await this.getStripe().subscriptions.retrieve(subscriptionId);
        await this.syncSubscription(subscription, tenantId, false);
      } else if (
        event.type === 'customer.subscription.created' ||
        event.type === 'customer.subscription.updated' ||
        event.type === 'customer.subscription.deleted'
      ) {
        const subscription = event.data.object as Stripe.Subscription;
        subscriptionId = subscription.id;
        customerId =
          typeof subscription.customer === 'string'
            ? subscription.customer
            : subscription.customer.id;
        tenantId = await this.resolveTenantId(subscription);
        if (!tenantId) throw new Error('Subscription event could not be mapped to a workspace');
        await this.syncSubscription(
          subscription,
          tenantId,
          event.type === 'customer.subscription.deleted',
        );
        if (event.type === 'customer.subscription.created') {
          await this.notifications?.createForPlatform({
            eventType: 'billing.subscription_created',
            category: 'billing',
            severity: 'success',
            audience: 'super_admin',
            title: 'Client subscription started',
            message: 'A client subscription was confirmed by Stripe.',
            deduplicationKey: `stripe:${event.id}`,
            actionUrl: '/admin/dashboard?view=billing',
            entityType: 'tenant',
            entityId: tenantId,
          });
        } else if (event.type === 'customer.subscription.deleted') {
          await this.saveBillingEvent(event, {
            tenantId,
            eventType: 'subscription_canceled',
            amountCents: 0,
            currency: subscription.currency || 'usd',
          });
          await this.notifications?.createForPlatform({
            eventType: 'billing.subscription_canceled',
            category: 'billing',
            severity: 'warning',
            audience: 'super_admin',
            title: 'Client subscription canceled',
            message: 'A client subscription ended. Review the shutdown follow-up task.',
            deduplicationKey: `stripe:${event.id}`,
            actionUrl: '/admin/dashboard?view=billing',
            entityType: 'tenant',
            entityId: tenantId,
          });
        }
      } else if (
        event.type === 'invoice.payment_failed' ||
        event.type === 'invoice.payment_succeeded'
      ) {
        const invoice = event.data.object as Stripe.Invoice;
        customerId =
          typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null;
        subscriptionId = this.invoiceSubscriptionId(invoice);
        if (subscriptionId) {
          const subscription = await this.getStripe().subscriptions.retrieve(subscriptionId);
          tenantId = await this.resolveTenantId(subscription);
          if (!tenantId)
            throw new Error('Invoice event could not be mapped to a workspace');
          await this.syncSubscription(subscription, tenantId, false, invoice.id);
          if (event.type === 'invoice.payment_failed') {
            await this.tenants.updateBilling(tenantId, {
              status: 'past_due',
              lastPaymentFailureAt: new Date(),
              latestInvoiceId: invoice.id,
              billingStateUpdatedAt: new Date(),
            });
            await this.operations?.createTask({
              tenantId,
              category: 'payment_failure',
              title: 'Client payment failed',
              description:
                'Review Stripe dunning, confirm the grace-period deadline, and contact the billing contact.',
              priority: 'high',
              relatedEntityType: 'tenant',
              relatedEntityId: tenantId,
              dedupeOpen: true,
            });
            await this.saveBillingEvent(event, {
              tenantId,
              eventType: 'payment_failed',
              invoiceId: invoice.id,
              amountCents: invoice.amount_due || 0,
              currency: invoice.currency || 'usd',
            });
            await this.notifications?.createForPlatform({
              eventType: 'billing.payment_failed',
              category: 'billing',
              severity: 'warning',
              audience: 'super_admin',
              title: 'Client payment failed',
              message: 'A client payment failed. Review the billing record and follow-up task.',
              deduplicationKey: `stripe:${event.id}`,
              actionUrl: '/admin/dashboard?view=billing',
              entityType: 'tenant',
              entityId: tenantId,
            });
            await this.notifications?.createForTenant?.({
              tenantId,
              eventType: 'billing.payment_failed',
              category: 'billing',
              severity: 'warning',
              title: 'Payment needs attention',
              message: 'Open Billing to update the payment method and keep service active.',
              deduplicationKey: `stripe:${event.id}`,
              actionUrl: '/app/billing',
              entityType: 'tenant',
              entityId: tenantId,
            });
            if (configuredBillingGraceDays() === 0) {
              await this.serviceControl?.suspend({
                tenantId,
                source: 'billing',
                reason:
                  'Stripe confirmed a failed payment and no billing grace period is configured.',
              });
            }
          } else {
            await this.recordSetupPaymentIfIncluded(
              subscription,
              tenantId,
              invoice.id,
              stripeDate(event.created) || new Date(),
            );
            await this.tenants.updateBilling(tenantId, {
              status: mapStripeStatusToTenantStatus(subscription.status),
              lastPaymentFailureAt: null,
              latestInvoiceId: invoice.id,
              billingStateUpdatedAt: new Date(),
            });
            await this.saveBillingEvent(event, {
              tenantId,
              eventType: 'invoice_paid',
              invoiceId: invoice.id,
              amountCents: invoice.amount_paid || 0,
              currency: invoice.currency || 'usd',
            });
            await this.notifications?.createForPlatform({
              eventType: 'billing.invoice_paid',
              category: 'billing',
              severity: 'success',
              audience: 'super_admin',
              title: 'Invoice paid',
              message: 'A client invoice was paid successfully.',
              deduplicationKey: `stripe:${event.id}`,
              actionUrl: '/admin/dashboard?view=billing',
              entityType: 'tenant',
              entityId: tenantId,
            });
            await this.notifications?.createForTenant?.({
              tenantId,
              eventType: 'billing.invoice_paid',
              category: 'billing',
              severity: 'success',
              title: 'Payment received',
              message: 'Your RealtyTechAI payment was received successfully.',
              deduplicationKey: `stripe:${event.id}`,
              actionUrl: '/app/billing',
              entityType: 'tenant',
              entityId: tenantId,
            });
          }
        }
      } else if (event.type === 'refund.created') {
        const refund = event.data.object as Stripe.Refund;
        const chargeId =
          typeof refund.charge === 'string' ? refund.charge : refund.charge?.id || null;
        const charge = chargeId ? await this.getStripe().charges.retrieve(chargeId) : null;
        const chargeCustomer = charge?.customer;
        customerId =
          typeof chargeCustomer === 'string'
            ? chargeCustomer
            : chargeCustomer?.id || null;
        const tenant = await this.tenants.findByStripeReference(null, customerId);
        tenantId = tenant?.id || null;
        await this.saveBillingEvent(event, {
          tenantId,
          eventType: 'refund',
          chargeId,
          amountCents: refund.amount || 0,
          currency: refund.currency || 'usd',
        });
        await this.notifications?.createForPlatform({
          eventType: 'billing.refund_created',
          category: 'billing',
          severity: 'warning',
          audience: 'super_admin',
          title: 'Client payment refunded',
          message: 'A Stripe refund was created. Review the client billing record.',
          deduplicationKey: `stripe:${event.id}`,
          actionUrl: '/admin/dashboard?view=billing',
          ...(tenantId ? { entityType: 'tenant', entityId: tenantId } : {}),
        });
      } else if (event.type === 'charge.dispute.created') {
        const dispute = event.data.object as Stripe.Dispute;
        const chargeId =
          typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id || null;
        const charge = chargeId ? await this.getStripe().charges.retrieve(chargeId) : null;
        customerId = charge
          ? typeof charge.customer === 'string'
            ? charge.customer
            : charge.customer?.id || null
          : null;
        const tenant = await this.tenants.findByStripeReference(null, customerId);
        tenantId = tenant?.id || null;
        await this.saveBillingEvent(event, {
          tenantId,
          eventType: 'dispute',
          chargeId,
          amountCents: dispute.amount || 0,
          currency: dispute.currency || 'usd',
        });
        await this.notifications?.createForPlatform({
          eventType: 'billing.dispute_created',
          category: 'billing',
          severity: 'critical',
          audience: 'super_admin',
          title: 'Stripe dispute opened',
          message: 'A Stripe payment dispute was opened. Review it in Stripe promptly.',
          deduplicationKey: `stripe:${event.id}`,
          actionUrl: '/admin/dashboard?view=billing',
          ...(tenantId ? { entityType: 'tenant', entityId: tenantId } : {}),
        });
      }

      if (claim.row && this.events) {
        claim.row.processingStatus = 'completed';
        claim.row.processingCompletedAt = new Date();
        claim.row.tenantId = tenantId;
        claim.row.stripeCustomerId = customerId;
        claim.row.stripeSubscriptionId = subscriptionId;
        await this.events.save(claim.row);
      }
      return { received: true };
    } catch (error) {
      const summary = sanitizedError(error);
      if (claim.row && this.events) {
        claim.row.processingStatus = 'failed';
        claim.row.processingCompletedAt = new Date();
        claim.row.errorSummary = summary;
        await this.events.save(claim.row);
      }
      this.logger.error(
        operationalEvent('stripe_webhook_failed', {
          stripeEventId: event.id,
          eventType: event.type,
          error: summary,
        }),
      );
      await this.notifications?.createForPlatform({
        eventType: 'billing.webhook_failed',
        category: 'system',
        severity: 'critical',
        audience: 'super_admin',
        title: 'Stripe webhook processing failed',
        message: `Stripe event ${event.type} could not be processed. Review system health.`,
        deduplicationKey: `stripe-failed:${event.id}`,
        actionUrl: '/admin/dashboard?view=billing',
      });
      throw error;
    }
  }

  private invoiceSubscriptionId(invoice: Stripe.Invoice) {
    const legacy = (invoice as any).subscription;
    const parent = (invoice as any).parent?.subscription_details?.subscription;
    const value = legacy || parent;
    return typeof value === 'string' ? value : value?.id || null;
  }

  private async recordSetupPaymentIfIncluded(
    subscription: Stripe.Subscription,
    tenantId: string,
    invoiceId: string,
    paidAt: Date,
  ) {
    if (String(subscription.metadata?.setupFeeIncluded || '') !== 'true') return;
    const setupPriceId = String(subscription.metadata?.setupPriceId || '').trim();
    if (!setupPriceId) {
      throw new Error('Setup fee subscription metadata is missing setupPriceId');
    }
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant || tenant.setupPaidAt) return;
    await this.tenants.updateBilling(tenantId, {
      setupPaidAt: paidAt,
      setupInvoiceId: invoiceId,
      setupStripePriceId: setupPriceId,
      billingStateUpdatedAt: new Date(),
    });
  }

  private async resolveTenantId(subscription: Stripe.Subscription) {
    const metadataTenant = String(subscription.metadata?.tenantId || '').trim();
    if (metadataTenant) return metadataTenant;
    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id;
    const tenant = await this.tenants.findByStripeReference(
      subscription.id,
      customerId,
    );
    return tenant?.id || null;
  }

  private async syncSubscription(
    subscription: Stripe.Subscription,
    tenantId: string,
    deleted: boolean,
    latestInvoiceId?: string,
  ) {
    const { priceId, productId, unitAmount, currency, interval } = this.subscriptionPrice(subscription);
    let mapped:
      | {
          plan: 'service';
          interval: ServiceBillingInterval;
          priceId: string;
          compatibility: boolean;
        }
      | null = planForStripePrice(priceId);
    if (!mapped && priceId) {
      const existing = await this.tenants.findById(tenantId);
      const sameStoredSubscription =
        existing?.stripeSubscriptionId === subscription.id &&
        existing?.stripePriceId === priceId;
      const recognizedStoredService = [
        'service',
        'pro',
        'teams',
        'enterprise',
      ].includes(String(existing?.plan || ''));
      if (sameStoredSubscription && recognizedStoredService) {
        mapped = {
          plan: 'service',
          interval,
          priceId,
          compatibility: true,
        };
        this.logger.warn(
          operationalEvent('legacy_stripe_price_accepted', {
            tenantId,
            subscriptionId: subscription.id,
            priceId,
          }),
        );
      }
    }
    if (!mapped) {
      this.logger.error(
        operationalEvent('unknown_stripe_price', {
          tenantId,
          subscriptionId: subscription.id,
          priceId: priceId || 'missing',
        }),
      );
      await this.tenants.updateBilling(tenantId, {
        status: 'incomplete',
        stripeSubscriptionStatus: subscription.status,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        stripeProductId: productId,
        billingStateUpdatedAt: new Date(),
      });
      await this.operations?.createTask({
        tenantId,
        category: 'unknown_stripe_price',
        title: 'Unknown Stripe price blocked plan activation',
        description: `Subscription ${subscription.id} references an unmapped Stripe price. Correct the configured price mapping before service activation.`,
        priority: 'critical',
        relatedEntityType: 'tenant',
        relatedEntityId: tenantId,
        dedupeOpen: true,
      });
      throw new Error(`Unknown Stripe price ID for subscription ${subscription.id}`);
    }

    const period = this.subscriptionPeriod(subscription);
    const customerId =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id;
    const status = deleted
      ? 'canceled'
      : mapStripeStatusToTenantStatus(subscription.status);
    await this.tenants.updateBilling(tenantId, {
      plan: mapped.plan,
      billingInterval: mapped.interval,
      status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripeSubscriptionStatus: deleted ? 'canceled' : subscription.status,
      stripePriceId: mapped.priceId,
      stripeProductId: productId,
      stripeUnitAmount: unitAmount,
      stripeCurrency: currency,
      stripeRecurringInterval: interval,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      trialStart: stripeDate(subscription.trial_start),
      trialEndsAt: stripeDate(subscription.trial_end),
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
      cancelAt: stripeDate(subscription.cancel_at),
      cancellationDate: stripeDate(subscription.cancel_at),
      canceledAt: stripeDate(subscription.canceled_at || subscription.ended_at),
      latestInvoiceId:
        latestInvoiceId ||
        (typeof subscription.latest_invoice === 'string'
          ? subscription.latest_invoice
          : subscription.latest_invoice?.id || null),
      stripeCheckoutSessionId: null,
      stripeCheckoutStartedAt: null,
      billingStateUpdatedAt: new Date(),
      ...(deleted ? { lifecycleStatus: 'CANCELED' as const } : {}),
    });
    if (deleted && this.settingsRepo) {
      await this.settingsRepo.update({ tenantId }, { automationsEnabled: false });
      await this.operations?.createTask({
        tenantId,
        category: 'cancellation_request',
        title: 'Stripe subscription ended',
        description:
          'Confirm service shutdown, preserve export/support access, and complete provider-disable follow-up.',
        priority: 'high',
        relatedEntityType: 'tenant',
        relatedEntityId: tenantId,
        dedupeOpen: true,
      });
    }
    if (!deleted && status === 'unpaid') {
      await this.serviceControl?.suspend({
        tenantId,
        source: 'billing',
        reason: 'Stripe confirmed that the subscription is unpaid.',
      });
    }
  }

  private async saveBillingEvent(
    event: Stripe.Event,
    input: {
      tenantId?: string | null;
      eventType: BillingEvent['eventType'];
      invoiceId?: string | null;
      chargeId?: string | null;
      amountCents?: number;
      currency?: string;
    },
  ) {
    if (!this.billingEvents) return;
    try {
      await this.billingEvents.save(
        this.billingEvents.create({
          providerEventId: event.id,
          tenantId: input.tenantId || null,
          eventType: input.eventType,
          invoiceId: input.invoiceId || null,
          chargeId: input.chargeId || null,
          amountCents: Math.max(0, Math.round(input.amountCents || 0)),
          currency: String(input.currency || 'usd').toLowerCase().slice(0, 3),
          livemode: Boolean(event.livemode),
          occurredAt: stripeDate(event.created) || new Date(),
        }),
      );
    } catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
    }
  }
}
