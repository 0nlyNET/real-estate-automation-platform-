import type { PlanName } from "@/lib/plan";

const ORDER: Record<PlanName, number> = {
  free: 0,
  trial: 1,
  pro: 2,
  teams: 3,
  enterprise: 4,
};

export function hasPlanAtLeast(current: PlanName, required: PlanName) {
  return (ORDER[current] ?? 0) >= (ORDER[required] ?? 0);
}

export function canUseTeams(current: PlanName) {
  return hasPlanAtLeast(current, "teams");
}

export function canUseBrokerage(current: PlanName) {
  return hasPlanAtLeast(current, "enterprise");
}

export function isAdminRole(role?: string | null) {
  const r = String(role || "").toLowerCase();
  return r === "owner" || r === "admin";
}

export function isManagerRole(role?: string | null) {
  const r = String(role || "").toLowerCase();
  return r === "owner" || r === "admin";
}
