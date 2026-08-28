import { apiFetch } from "@/lib/api"

export type PlanName = "trial" | "free" | "service" | "pro" | "teams" | "enterprise"
export type PlanStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused"

export type MePlan = {
  plan: PlanName
  status: PlanStatus
  billingInterval: "month" | "year"
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  cancelAt: string | null
  stripeSubscriptionStatus: string | null
  lifecycleStatus: string
  serviceState: {
    state: "active" | "payment_overdue" | "grace_period" | "suspended" | "paused" | "onboarding" | "canceled"
    label: string
    reason: string
    graceEndsAt: string | null
  }
  serviceSuspendedAt: string | null
  serviceSuspensionReason: string | null
  serviceSuspensionSource: "manual" | "billing" | null
  serviceRestoredAt: string | null
}

export async function fetchMePlan(): Promise<MePlan> {
  return apiFetch<MePlan>("/me/plan")
}

export function formatDate(d: string | null | undefined) {
  if (!d) return null
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}
