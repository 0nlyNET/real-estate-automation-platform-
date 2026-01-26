export default function FAQPage() {
  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">FAQ</h1>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">How do I connect Twilio?</h2>
        <p className="text-sm text-muted-foreground">Go to Integrations and connect your Twilio Account SID, Auth Token, and From Number.</p>
      </div>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">Why aren’t my texts sending?</h2>
        <p className="text-sm text-muted-foreground">Confirm Twilio is connected and your billing plan is active. If payment failed, update your card in Billing.</p>
      </div>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">How do I cancel?</h2>
        <p className="text-sm text-muted-foreground">Open Billing and click Manage billing to cancel in the Stripe customer portal.</p>
      </div>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">How do I change plans?</h2>
        <p className="text-sm text-muted-foreground">Use the Upgrade button on Billing. For downgrades, use the Stripe customer portal.</p>
      </div>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">How do I add leads?</h2>
        <p className="text-sm text-muted-foreground">Add them manually in Leads or post to your intake webhook endpoint.</p>
      </div>
    </div>
  )
}
