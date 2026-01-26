import { apiFetch } from "@/lib/api"

export type PlanName = "trial" | "free" | "pro" | "teams" | "enterprise"
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
}

export async function fetchMePlan(): Promise<MePlan | null> {
  try {
    const res = await apiFetch("/me/plan")
    return res || null
  } catch {
    return null
  }
}

export function formatDate(d: string | null | undefined) {
  if (!d) return null
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}
