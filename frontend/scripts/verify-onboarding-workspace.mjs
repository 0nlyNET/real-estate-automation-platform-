import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import { launchProgress, nextReadinessStep, unmappedReadinessChecks } from "../lib/launch-readiness.ts"

const source = readFileSync(new URL("../app/admin/dashboard/admin-dashboard-client.tsx", import.meta.url), "utf8")
const required = [
  "Client launch workspace", "Current blocker:", "Next step:", "Guided setup",
  "Invitation accepted", "Payment / Stripe active", "AI configuration approved",
  "Inbound replies tested", "First-client integrations", "Test status:",
  "Critical blockers", "Passed checks", "readiness.ready", "resendSelectedInvitation",
  "passwordConfigured", "configurationApprovalStatus", "Responsible: {step.owner}",
]
const missing = required.filter((value) => !source.includes(value))
if (missing.length) throw new Error(`Onboarding workspace regression: missing ${missing.join(", ")}`)
if (!source.includes('disabled={!readiness.ready')) throw new Error("Activation must remain readiness-gated")
console.log(`Admin onboarding workspace verification passed (${required.length} persisted-state and guided-flow controls).`)

const completed = [{ keys: ["billing"], status: "Complete" }]
assert.equal(launchProgress(completed, false), 99, "Backend blockers must prevent a 100% ready claim")
assert.equal(launchProgress(completed, true), 100)
assert.deepEqual(unmappedReadinessChecks([{ key: "billing" }, { key: "new_prerequisite" }], completed), [{ key: "new_prerequisite" }])
const steps = [
  { keys: ["test_lead"], status: "Waiting on Admin", special: "test" },
  { keys: ["new_prerequisite"], status: "Blocked" },
]
assert.equal(nextReadinessStep(steps, [{ key: "new_prerequisite" }]), steps[1], "Resolve prerequisites before directing an operator to testing")
assert.equal(nextReadinessStep(steps, []), steps[0])
assert.match(source, /disabled=\{Boolean\(step.disabledReason\)/, "Staff must not receive enabled owner-only actions")
assert.match(source, /id: "inbound_reply"[^\n]*keys: \["inbound_email", "inbound_sms", "stop"\]/, "Inbound evidence must be labelled as inbound testing")
assert.match(source, /Retry client details/, "Readiness fetch failures must remain visible and retryable")
console.log("Onboarding blocker coverage, progress, evidence labels, and permission regressions passed.")
