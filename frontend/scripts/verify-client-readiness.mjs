import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), "utf8")

const publicFiles = [
  "app/page.tsx",
  "app/about/page.tsx",
  "app/apply/page.tsx",
  "app/contact/page.tsx",
  "app/features/page.tsx",
  "app/pricing/page.tsx",
  "app/use-cases/page.tsx",
  "components/ui/marketing-header.tsx",
  "components/ui/footer.tsx",
]
const publicSource = publicFiles.map(read).join("\n")

for (const pattern of [
  /\bAI[- ]powered\b/i,
  /\bguaranteed?\b/i,
  /\b24\s*\/\s*7\b/i,
  /\bclose more deals\b/i,
  /\bnever miss a lead\b/i,
  /\btrusted by\b/i,
  /\b10x\b/i,
]) {
  assert.equal(pattern.test(publicSource), false, `unsupported public claim: ${pattern}`)
}

const linkSources = [...publicFiles, "app/thanks/page.tsx", "app/signup/page.tsx"]
  .map(read)
  .join("\n")
const links = [...linkSources.matchAll(/href=["'](\/[A-Za-z0-9_\-/]*)["']/g)].map((match) => match[1])
for (const href of links) {
  if (href === "/") continue
  const route = href.replace(/^\//, "").replace(/\/$/, "")
  assert.equal(existsSync(join(root, "app", route, "page.tsx")), true, `broken static CTA: ${href}`)
}

const pricing = read("lib/public-plan-catalog.ts")
assert.match(pricing, /Contact for pilot pricing/)
assert.doesNotMatch(pricing, /pricing:\s*["']\s*["']/)

const legal = ["app/privacy/page.tsx", "app/terms/page.tsx", "app/refund/page.tsx"].map(read).join("\n")
assert.doesNotMatch(legal, /RealtyTechAI LLC|123 Tech Lane|Austin, TX|privacy@|legal@|256-bit|regular security audits/i)
assert.match(legal, /data-deletion request/i)

const authSource = [
  "app/login/page.tsx",
  "app/logout/page.tsx",
  "lib/api.ts",
  "lib/impersonation.ts",
  "proxy.ts",
].map(read).join("\n")
assert.doesNotMatch(authSource, /localStorage|document\.cookie/)
const proxySource = read("proxy.ts")
assert.doesNotMatch(proxySource, /decodePayload|token\.split|\batob\b/)
assert.match(proxySource, /fetch\(`\$\{backend\}\/me`/)
assert.match(proxySource, /session\.isPlatformAdmin/)
assert.match(read("app/api/backend/[...path]/route.ts"), /BACKEND_API_URL/)
assert.match(read("next.config.mjs"), /Content-Security-Policy/)
assert.match(read("next.config.mjs"), /frame-ancestors 'none'/)

const application = read("app/apply/page.tsx")
assert.match(application, /Your application was received\. Our team will review it/)
assert.match(application, /role="status"/)

const inbox = read("app/app/inbox/page.tsx")
assert.match(inbox, /Provider accepted/)
assert.match(inbox, /Failed:/)
assert.match(inbox, /providerStatus/)

const onboarding = read("app/app/onboarding/page.tsx")
assert.match(onboarding, /readiness\?\.required\.map/)
assert.match(onboarding, /Clients cannot self-activate/)

const sidebar = read("components/app-shell/sidebar.tsx")
assert.match(sidebar, /label: "Support", href: "\/support"/)

const admin = read("app/admin/dashboard/page.tsx")
assert.match(admin, /\/admin\/applications\?take=25/)
assert.match(admin, /\/admin\/operations\?take=50/)
assert.match(admin, /\/support\/admin\/tickets/)
assert.match(admin, /Overdue only/)
assert.match(admin, /Open related record/)

console.log(`Client-readiness frontend verification passed (${links.length} static links checked).`)
