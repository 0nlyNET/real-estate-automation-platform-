"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"

import { apiFetch } from "@/lib/api"

type PlanResp = {
  tenantId: string
  plan: string
  status: string
  trialEndsAt?: string | null
  currentPeriodEnd?: string | null
}

export default function BillingPage() {
  const params = useSearchParams()
  const [plan, setPlan] = useState<PlanResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const banner = params.get("status")

  useEffect(() => {
    let active = true

    ;(async () => {
      setError(null)
      setLoading(true)

      try {
        const data = await apiFetch<PlanResp>("/me/plan", { auth: true })
        if (active) setPlan(data)
      } catch (e: any) {
        if (active) setError(e?.message || "Failed to load billing")
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [])

  const trialLabel = useMemo(() => {
    if (!plan?.trialEndsAt) return null
    const dt = new Date(plan.trialEndsAt)
    if (Number.isNaN(dt.getTime())) return null
    return dt.toLocaleDateString()
  }, [plan?.trialEndsAt])

  async function openPortal() {
    setBusy(true)
    setError(null)

    try {
      const origin = window.location.origin
      const res = await apiFetch<{ url: string }>("/billing/portal-session", {
        method: "POST",
        auth: true,
        json: { returnUrl: `${origin}/app/billing` },
      })

      window.location.href = res.url
    } catch (e: any) {
      setError(e?.message || "Failed to open portal")
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Manage your plan and subscription.
        </p>
      </div>

      {banner === "success" ? (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          Payment successful. Your plan will update in a moment.
        </div>
      ) : null}

      {banner === "cancel" ? (
        <div className="mb-4 rounded-lg border p-3 text-sm">
          Checkout canceled.
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border p-6">Loading...</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <div className="rounded-xl border p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Current plan</div>
              <div className="text-xl font-semibold capitalize">
                {plan?.plan || "trial"}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Status: {plan?.status || "trialing"}
              </div>
              {trialLabel ? (
                <div className="mt-1 text-sm text-muted-foreground">
                  Trial ends: {trialLabel}
                </div>
              ) : null}
            </div>

            <div className="flex gap-2">
              <Link
                className="rounded-lg border px-4 py-2 text-sm"
                href="/app/billing/upgrade"
              >
                Upgrade
              </Link>

              <button
                className="rounded-lg border px-4 py-2 text-sm disabled:opacity-60"
                onClick={openPortal}
                disabled={busy}
              >
                {busy ? "Opening..." : "Manage"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
