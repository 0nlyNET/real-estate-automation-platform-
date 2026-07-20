"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/app/app/_components/PageShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api"
import { fetchMePlan, MePlan } from "@/lib/plan"

export default function BillingPage() {
  const [billing, setBilling] = useState<MePlan | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  useEffect(() => { void fetchMePlan().then(setBilling) }, [])

  const hasSubscription = Boolean(
    billing && ["active", "trialing", "past_due", "unpaid", "paused"].includes(billing.status),
  )

  async function openBilling() {
    setLoading(true)
    setError("")
    try {
      const path = hasSubscription ? "/billing/portal-session" : "/billing/checkout-session"
      const result = await apiFetch<{ url: string }>(path, {
        method: "POST",
        body: hasSubscription ? undefined : {},
      })
      window.location.href = result.url
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Secure billing could not be opened")
      setLoading(false)
    }
  }

  return (
    <PageShell title="Billing" subtitle="One RealtyTechAI service, billed securely through Stripe.">
      {error ? <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">{error}</div> : null}
      <Card>
        <CardHeader>
          <CardTitle>RealtyTechAI managed service</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm text-muted-foreground">Service status</div>
            <div className="mt-1 text-2xl font-semibold capitalize">{billing?.status?.replaceAll("_", " ") || "Loading…"}</div>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Your dashboard, team tools, connections, lead follow-up, reporting, and support are part of the same managed service. There are no plan choices inside this workspace.
          </p>
          <Button onClick={() => void openBilling()} disabled={!billing || loading}>
            {loading ? "Opening Stripe…" : hasSubscription ? "Manage billing securely" : "Set up billing securely"}
          </Button>
        </CardContent>
      </Card>
    </PageShell>
  )
}
