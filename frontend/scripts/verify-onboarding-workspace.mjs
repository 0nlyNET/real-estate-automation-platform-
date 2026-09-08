import { readFileSync } from "node:fs"

const source = readFileSync(new URL("../app/admin/dashboard/admin-dashboard-client.tsx", import.meta.url), "utf8")
const required = [
  "Client launch workspace", "Current blocker:", "Next step:", "Guided setup",
  "Invitation accepted", "Payment / Stripe active", "AI configuration approved",
  "Manual conversation reply tested", "First-client integrations", "Test status:",
  "Critical blockers", "Passed checks", "readiness.ready", "resendSelectedInvitation",
  "passwordConfigured", "configurationApprovalStatus", "Responsible: {step.owner}",
]
const missing = required.filter((value) => !source.includes(value))
if (missing.length) throw new Error(`Onboarding workspace regression: missing ${missing.join(", ")}`)
if (!source.includes('disabled={!readiness.ready')) throw new Error("Activation must remain readiness-gated")
console.log(`Admin onboarding workspace verification passed (${required.length} persisted-state and guided-flow controls).`)
