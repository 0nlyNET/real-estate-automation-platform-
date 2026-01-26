"use client"

import Link from "next/link"
import { usePlan } from "@/hooks/use-plan"

export function PlanBadge() {
  const { normalized, plan, loading } = usePlan()

  const label =
    normalized === "teams" ? "Teams Plan" :
    normalized === "pro" ? "Pro Plan" :
    normalized === "starter" ? "Starter Plan" :
    "Trial Plan"

  const sub =
    normalized === "trial" && plan?.trialEndsAt
      ? "Ends soon"
      : normalized !== "trial"
        ? "Active"
        : " "

  return (
    <Link
      href="/app/billing"
      className="block rounded-lg border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10 transition"
    >
      <div className="text-xs font-medium">{loading ? "Loading..." : label}</div>
      <div className="text-[11px] text-muted-foreground">{loading ? " " : sub}</div>
      <div className="mt-2 h-1 w-full rounded bg-white/10 overflow-hidden">
        <div
          className="h-full rounded bg-cyan-500"
          style={{ width: normalized === "trial" ? "35%" : "100%" }}
        />
      </div>
    </Link>
  )
}
