import { Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingReconciliationService } from './billing-reconciliation.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireRole, RolesGuard } from '../../common/guards/roles.guard';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly reconciliation: BillingReconciliationService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  @Post('checkout-session')
  async checkoutSession(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    const frontend = String(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    return this.billing.createCheckoutSession({
      tenantId,
      userEmail: req.user?.email,
      successUrl: `${frontend}/app/billing?checkout=success`,
      cancelUrl: `${frontend}/app/billing?checkout=cancelled`,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  @Post('portal-session')
  async portalSession(@Req() req: any) {
    const tenantId = req.user?.tenantId;
    const frontend = String(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
    return this.billing.createPortalSession({ tenantId, returnUrl: `${frontend}/app/billing` });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole('admin')
  @Post('reconcile')
  async reconcile(@Req() req: any) {
    return this.reconciliation.reconcileTenant(req.user?.tenantId);
  }

  @Post('webhook')
  webhook(@Req() req: any, @Headers('stripe-signature') signature?: string) {
    return this.billing.handleWebhook(req.rawBody, signature || '');
  }
}
