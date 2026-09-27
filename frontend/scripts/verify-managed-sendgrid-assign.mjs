import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const source = await readFile("components/admin/managed-integrations.tsx", "utf8")

// The Client SendGrid card must expose the direct operator assignment form.
// Backend PUT /admin/tenants/:tenantId/integrations/sendgrid is intentionally
// ungated by onboarding readiness: reconcile cannot provision the managed
// identity on its own because the brand readiness check requires the approved
// email identity that only exists after provisioning.
assert.match(source, /Assign managed identity/, "assign form heading/button missing")
assert.match(source, /tenantSendgridFromEmail/, "from-email state missing")
assert.match(source, /tenantSendgridFromName/, "from-name state missing")
assert.match(source, /tenantSendgridInboundAddress/, "inbound-address state missing")
assert.match(
  source,
  /apiFetch\(`\/admin\/tenants\/\$\{tenantId\}\/integrations\/sendgrid`,\s*\{\s*method:\s*"PUT"/,
  "assign action must PUT to /admin/tenants/${tenantId}/integrations/sendgrid",
)
assert.match(source, /inboundAddress: tenantSendgridInboundAddress\.trim\(\) \|\| undefined/, "inbound address must be optional (auto-generated when blank)")
assert.match(source, /fromEmail,\s*\n?\s*fromName: tenantSendgridFromName/, "assign payload must include fromEmail/fromName")
// The provisioned inbound address must be visible after assignment.
assert.match(source, /tenant\?\.sendgrid\.display\?\.inboundAddress/, "inbound reply address display missing")

console.log("Managed SendGrid assign form passed")
