"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/api"

export type PlanData = {
  plan?: string
  status?: string
  trialEndsAt?: string | null
  currentPeriodEnd?: string | null
  stripeCustomerId?: string | null
  stripeSubscriptionId?: string | null
  updatedAt?: string | null
}

export function normalizePlanName(p?: string) {
  const v = (p || "").toLowerCase()
  if (!v) return "trial"
  if (v.includes("team")) return "teams"
  if (v.includes("pro")) return "pro"
  if (v.includes("starter")) return "starter"
  if (v.includes("trial")) return "trial"
  return v
}

export function usePlan() {
  const [plan, setPlan] = useState<PlanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch("/me/plan", { method: "GET" })
      setPlan(data || null)
    } catch (e: any) {
      setError(e?.message || "Failed to load plan")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const normalized = useMemo(() => normalizePlanName(plan?.plan), [plan?.plan])

  return { plan, normalized, loading, error, refresh }
}
