import { Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import Stripe from 'stripe';
import { BillingService } from './billing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantsService } from '../tenants/tenants.service';
import { applyStripeEventToTenant } from './webhook-updates';

@Controller('billing')
export class BillingController {
  private stripe: Stripe;

  constructor(
    private readonly billing: BillingService,
    private readonly tenants: TenantsService,
  ) {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
      apiVersion: '2024-06-20',
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('checkout-session')
  async checkoutSession(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    return await this.billing.createCheckoutSession(tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('portal-session')
  async portalSession(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    return await this.billing.createPortalSession(tenantId);
  }

  @Post('webhook')
  async webhook(@Req() req: any, @Res() res: Response) {
    const sig = req.headers['stripe-signature'];
    const whsec = process.env.STRIPE_WEBHOOK_SECRET || '';

    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(req.body, sig as string, whsec);
    } catch (err: any) {
      return res.status(400).send(`Webhook Error: ${err?.message || 'Invalid signature'}`);
    }

    try {
      if (typeof (this.billing as any).handleWebhookEvent === 'function') {
        await (this.billing as any).handleWebhookEvent(event);
      }
    } catch {}

    try {
      await applyStripeEventToTenant(event, this.tenants);
    } catch {}

    return res.json({ received: true });
  }
}
