"use client"

import { useEffect, useMemo, useState } from "react"
import { apiFetch } from "@/lib/api"

export type PlanResponse = {
  tenantId: string
  plan: string
  status: string
  trialEndsAt: string | null
  currentPeriodEnd: string | null
}

function daysUntil(iso: string | null) {
  if (!iso) return null
  const end = new Date(iso)
  if (Number.isNaN(end.getTime())) return null
  const now = new Date()
  const diff = end.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

export function usePlan() {
  const [loading, setLoading] = useState(true)
  const [plan, setPlan] = useState<PlanResponse | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await apiFetch<PlanResponse>("/me/plan")
        if (alive) setPlan(data)
      } catch {
        if (alive) setPlan(null)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const planName = useMemo(() => {
    const p = plan?.plan || "trial"
    return p.charAt(0).toUpperCase() + p.slice(1)
  }, [plan])

  const daysRemaining = useMemo(() => {
    if (!plan) return null
    if (plan.status === "trialing") return daysUntil(plan.trialEndsAt)
    return daysUntil(plan.currentPeriodEnd)
  }, [plan])

  return { loading, plan, planName, daysRemaining }
}
