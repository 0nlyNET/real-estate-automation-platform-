import { TenantsService } from '../tenants/tenants.service';

export async function applyStripeEventToTenant(event: any, tenants: TenantsService) {
  const type = String(event?.type || '');

  if (type === 'invoice.payment_failed') {
    const tenantId =
      event?.data?.object?.metadata?.tenantId ||
      event?.data?.object?.lines?.data?.[0]?.metadata?.tenantId ||
      null;

    if (tenantId) await tenants.setPastDue(String(tenantId));
    return;
  }

  if (type === 'invoice.payment_succeeded') {
    const tenantId =
      event?.data?.object?.metadata?.tenantId ||
      event?.data?.object?.lines?.data?.[0]?.metadata?.tenantId ||
      null;

    if (tenantId) await tenants.setActive(String(tenantId));
    return;
  }

  if (
    type === 'customer.subscription.created' ||
    type === 'customer.subscription.updated' ||
    type === 'customer.subscription.deleted'
  ) {
    const sub = event?.data?.object;
    const tenantId = sub?.metadata?.tenantId || null;

    if (tenantId) {
      await tenants.updateFromStripeSubscription(String(tenantId), {
        id: sub?.id || null,
        status: sub?.status || null,
        current_period_end: sub?.current_period_end || null,
        cancel_at: sub?.cancel_at || null,
        cancel_at_period_end: sub?.cancel_at_period_end || null,
      });
    }
    return;
  }
}
