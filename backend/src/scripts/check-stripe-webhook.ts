import Stripe = require('stripe');

export const REQUIRED_BILLING_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'refund.created',
  'charge.dispute.created',
] as const;

// Dry-run by default. The caller must supply the exact endpoint and backend
// origin. This never creates a new endpoint or replaces a signing secret.
export async function checkStripeWebhook(
  stripe: Stripe,
  input: { endpointId: string; backendOrigin: string; appEnv: string; apply?: boolean },
) {
  if (!['production', 'staging', 'test'].includes(input.appEnv)) throw new Error('APP_ENV must be explicit');
  const expected = new URL('/billing/webhook', input.backendOrigin);
  if (expected.protocol !== 'https:' || expected.username || expected.password) throw new Error('HTTPS backend origin required');
  const endpoint = await stripe.webhookEndpoints.retrieve(input.endpointId);
  if (endpoint.livemode !== (input.appEnv === 'production')) throw new Error('Stripe endpoint environment mismatch');
  if (endpoint.url !== expected.href) throw new Error('Stripe endpoint URL mismatch');
  if (endpoint.status !== 'enabled') throw new Error('Stripe endpoint is disabled');
  const missing = endpoint.enabled_events.includes('*') ? [] :
    REQUIRED_BILLING_EVENTS.filter(event => !endpoint.enabled_events.includes(event));
  if (input.apply && missing.length) {
    await stripe.webhookEndpoints.update(endpoint.id, {
      enabled_events: [...new Set([...endpoint.enabled_events, ...missing])] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
    });
    const after = await stripe.webhookEndpoints.retrieve(endpoint.id);
    if (!REQUIRED_BILLING_EVENTS.every(event => after.enabled_events.includes('*') || after.enabled_events.includes(event))) {
      throw new Error('Stripe webhook update was not verified');
    }
  }
  return { endpointId: endpoint.id, livemode: endpoint.livemode, missing, applied: Boolean(input.apply && missing.length) };
}

if (require.main === module) {
  const [endpointId, backendOrigin, mode] = process.argv.slice(2);
  if (!endpointId || !backendOrigin || (mode && mode !== '--apply')) throw new Error('Usage: check-stripe-webhook ENDPOINT_ID HTTPS_ORIGIN [--apply]');
  checkStripeWebhook(new Stripe(process.env.STRIPE_SECRET_KEY || ''), {
    endpointId, backendOrigin, appEnv: process.env.APP_ENV || '', apply: mode === '--apply',
  }).then(result => console.log(JSON.stringify(result))).catch(error => {
    // Never log provider error objects (can include request credentials).
    console.error(JSON.stringify({ ok: false, name: error.name, code: error.code || null }));
    process.exitCode = 1;
  });
}
