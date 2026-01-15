import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingService } from './billing.service';
import { CheckoutSessionDto, PortalSessionDto } from './dto/billing.dto';

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @UseGuards(JwtAuthGuard)
  @Post('checkout-session')
  async checkout(@Req() req: any, @Body() dto: CheckoutSessionDto) {
    const frontend = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const successUrl = `${frontend}/app/billing?status=success`;
    const cancelUrl = `${frontend}/app/billing?status=cancel`;

    return await this.billing.createCheckoutSession({
      tenantId: req.user.tenantId,
      userEmail: req.user.email,
      plan: dto.plan,
      interval: dto.interval,
      successUrl,
      cancelUrl,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('portal-session')
  async portal(@Req() req: any, @Body() dto: PortalSessionDto) {
    const fallback = (process.env.STRIPE_PORTAL_RETURN_URL || (process.env.FRONTEND_URL || 'http://localhost:3000') + '/app/billing').toString();
    return await this.billing.createPortalSession({
      tenantId: req.user.tenantId,
      returnUrl: dto.returnUrl || fallback,
    });
  }

  // Stripe webhook: rawBody enabled in main.ts (NestFactory.create(..., { rawBody: true }))
  @Post('webhook')
  async webhook(@Req() req: any, @Headers('stripe-signature') signature: string) {
    const raw: Buffer = req.rawBody;
    return await this.billing.handleWebhook(raw, signature);
  }
}
