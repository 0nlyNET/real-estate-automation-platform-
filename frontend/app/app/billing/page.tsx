"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/app/app/_components/PageShell"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api"
import { fetchMePlan, MePlan } from "@/lib/plan"

const OPEN_SUBSCRIPTION_STATES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
])

export default function BillingPage() {
  const [billing, setBilling] = useState<MePlan | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [loading, setLoading] = useState(false)
  const [canManage, setCanManage] = useState<boolean | null>(null)

  async function refreshBilling() {
    try {
      await apiFetch("/billing/reconcile", { method: "POST" })
    } catch {
      // Webhooks remain the primary sync path. Keep the last known state available
      // if Stripe is temporarily unavailable during this best-effort repair.
    }
    const [current, me] = await Promise.all([
      fetchMePlan(),
      apiFetch<{ role: string }>("/me"),
    ])
    setBilling(current)
    setCanManage(me.role === "owner" || me.role === "admin")
    return current
  }

  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get("checkout")
    if (checkout) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.hash}`)
    }
    const initialLoad = window.setTimeout(() => {
      if (checkout === "success") {
        setNotice("Payment was submitted. RealtyTechAI is confirming the subscription with Stripe before activation.")
      } else if (checkout === "cancelled") {
        setNotice("Checkout was canceled and no payment was submitted. You can resume securely when ready.")
      }
      void refreshBilling().catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Billing status could not be loaded")
      })
    }, 0)
    return () => window.clearTimeout(initialLoad)
  }, [])

  const hasSubscription = Boolean(
    billing?.stripeSubscriptionStatus &&
      OPEN_SUBSCRIPTION_STATES.has(billing.stripeSubscriptionStatus),
  )

  async function openBilling() {
    if (!canManage) {
      setError("A workspace owner or administrator must manage billing.")
      return
    }
    setLoading(true)
    setError("")
    try {
      const current = await refreshBilling()
      if (!current) throw new Error("Billing status could not be loaded")
      const currentHasSubscription = Boolean(
        current.stripeSubscriptionStatus &&
          OPEN_SUBSCRIPTION_STATES.has(current.stripeSubscriptionStatus),
      )
      const path = currentHasSubscription ? "/billing/portal-session" : "/billing/checkout-session"
      const result = await apiFetch<{ url: string }>(path, {
        method: "POST",
        body: currentHasSubscription ? undefined : {},
      })
      window.location.href = result.url
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Secure billing could not be opened")
      setLoading(false)
    }
  }

  return (
    <PageShell title="Billing" subtitle="One RealtyTechAI service, billed securely through Stripe.">
      {notice ? <div role="status" className="rounded-md border bg-muted/30 p-3 text-sm">{notice}</div> : null}
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
          {canManage === false ? (
            <p role="status" className="text-sm text-muted-foreground">
              A workspace owner or administrator must manage billing.
            </p>
          ) : null}
          <Button onClick={() => void openBilling()} disabled={!billing || loading || canManage !== true}>
            {loading ? "Opening Stripe…" : canManage === false ? "Workspace admin required" : hasSubscription ? "Manage billing securely" : "Set up billing securely"}
          </Button>
        </CardContent>
      </Card>
    </PageShell>
  )
}
