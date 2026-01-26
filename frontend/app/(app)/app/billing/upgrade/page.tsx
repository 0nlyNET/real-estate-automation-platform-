"use client"

import { useState } from "react"
import Link from "next/link"

import { apiFetch } from "@/lib/api"

export default function UpgradePage() {
  const [plan, setPlan] = useState<"pro" | "teams">("pro")
  const [interval, setInterval] = useState<"month" | "year">("month")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startCheckout() {
    setBusy(true)
    setError(null)

    try {
      const res = await apiFetch<{ url: string }>("/billing/checkout-session", {
        method: "POST",
        auth: true,
        json: { plan, interval },
      })
      window.location.href = res.url
    } catch (e: any) {
      setError(e?.message || "Checkout failed")
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Upgrade</h1>
          <p className="text-sm text-muted-foreground">Choose a plan and complete checkout.</p>
        </div>
        <Link className="rounded-lg border px-3 py-2 text-sm" href="/app/billing">
          Back
        </Link>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="rounded-xl border p-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="text-sm font-medium">Plan</div>
            <div className="mt-3 space-y-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-3">
                <input
                  type="radio"
                  name="plan"
                  checked={plan === "pro"}
                  onChange={() => setPlan("pro")}
                />
                <div>
                  <div className="font-semibold">Pro</div>
                  <div className="text-sm text-muted-foreground">Best for solo agents</div>
                </div>
              </label>

              <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-3">
                <input
                  type="radio"
                  name="plan"
                  checked={plan === "teams"}
                  onChange={() => setPlan("teams")}
                />
                <div>
                  <div className="font-semibold">Teams</div>
                  <div className="text-sm text-muted-foreground">Best for teams and brokerages</div>
                </div>
              </label>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium">Billing</div>
            <div className="mt-3 space-y-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-3">
                <input
                  type="radio"
                  name="interval"
                  checked={interval === "month"}
                  onChange={() => setInterval("month")}
                />
                <div>
                  <div className="font-semibold">Monthly</div>
                  <div className="text-sm text-muted-foreground">Pay month to month</div>
                </div>
              </label>

              <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-3">
                <input
                  type="radio"
                  name="interval"
                  checked={interval === "year"}
                  onChange={() => setInterval("year")}
                />
                <div>
                  <div className="font-semibold">Annual</div>
                  <div className="text-sm text-muted-foreground">Pay once per year</div>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            className="rounded-lg border px-4 py-2 text-sm disabled:opacity-60"
            onClick={startCheckout}
            disabled={busy}
          >
            {busy ? "Redirecting..." : "Continue to Stripe"}
          </button>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Note: Stripe product/price IDs must be configured in your backend environment variables.
      </p>
    </div>
  )
}
