import type { PlanName } from "@/lib/plan"
import { canUseTeams, canUseBrokerage } from "@/lib/access"

export function gateLabel(plan: PlanName, required: "teams" | "enterprise") {
  if (required === "enterprise") return canUseBrokerage(plan) ? null : "Enterprise"
  return canUseTeams(plan) ? null : "Teams"
}

export function isAllowed(plan: PlanName, required: "teams" | "enterprise") {
  if (required === "enterprise") return canUseBrokerage(plan)
  return canUseTeams(plan)
}
