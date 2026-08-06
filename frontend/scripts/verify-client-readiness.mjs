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

const linkSources = [...publicFiles, "app/thanks/page.tsx", "app/signup/page.tsx"].map(read).join("\n")
const links = [...linkSources.matchAll(/href=["'](\/[A-Za-z0-9_\-/]*)["']/g)].map((match) => match[1])
for (const href of links) {
  if (href === "/") continue
  const route = href.replace(/^\//, "").replace(/\/$/, "")
  assert.equal(existsSync(join(root, "app", route, "page.tsx")), true, `broken static CTA: ${href}`)
}

const pricing = read("lib/public-plan-catalog.ts")
assert.match(pricing, /RealtyTechAI managed service/)
assert.equal((pricing.match(/id:/g) || []).length, 1, "client pricing must expose one service")
assert.doesNotMatch(pricing, /pricing:\s*["']\s*["']/)

const legal = ["app/privacy/page.tsx", "app/terms/page.tsx", "app/refund/page.tsx"].map(read).join("\n")
assert.doesNotMatch(legal, /RealtyTechAI LLC|123 Tech Lane|Austin, TX|privacy@|legal@|256-bit|regular security audits/i)
assert.match(legal, /data-deletion request/i)

const authSource = ["app/login/page.tsx", "app/logout/page.tsx", "lib/api.ts", "lib/impersonation.ts", "proxy.ts"]
  .map(read)
  .join("\n")
assert.doesNotMatch(authSource, /localStorage|document\.cookie/)
const proxySource = read("proxy.ts")
assert.doesNotMatch(proxySource, /decodePayload|token\.split|\batob\b/)
assert.match(proxySource, /fetch\(`\$\{backend\}\/me`/)
assert.match(proxySource, /session\.platformRole/)
assert.match(read("app/api/backend/[...path]/route.ts"), /BACKEND_API_URL/)
assert.match(read("next.config.mjs"), /Content-Security-Policy/)
assert.match(read("next.config.mjs"), /frame-ancestors 'none'/)

const application = read("app/apply/page.tsx")
assert.match(application, /Your application was received\. Our team will review it/)
assert.match(application, /role="status"/)

const inbox = read("app/app/inbox/page.tsx")
assert.match(inbox, /Conversations/)
assert.match(inbox, /Pause follow-up/)
assert.match(inbox, /Add to Today/)
assert.match(inbox, /This message did not send/)
assert.match(inbox, /AiConversationControls/)
assert.match(inbox, /AI-generated/)
assert.match(inbox, /Human-written/)
assert.match(inbox, /Approved automation/)
assert.match(inbox, /Reply channel/)
assert.match(inbox, /channel: sendChannel/)
assert.match(inbox, /switch the conversation to human handling/)
assert.doesNotMatch(inbox, /Provider accepted|providerStatus|webhook/i)

const conversationControls = read("components/ai/conversation-controls.tsx")
assert.match(conversationControls, /Take Over/)
assert.match(conversationControls, /Return to AI/)
assert.match(conversationControls, /window\.confirm/)
assert.match(conversationControls, /drafts\/\$\{draft\.id\}\/approve/)
assert.match(conversationControls, /drafts\/\$\{draft\.id\}\/edit-and-send/)
assert.match(conversationControls, /drafts\/\$\{draft\.id\}\/reject/)
assert.match(conversationControls, /AI-generated summary/)
assert.match(read("app/app/leads/[id]/page.tsx"), /AiConversationControls/)

const aiSettings = read("components/settings/ai-assistant-settings.tsx")
assert.match(read("app/app/settings/page.tsx"), /AiAssistantSettings/)
assert.match(aiSettings, /value="human_only"/)
assert.match(aiSettings, /value="draft"/)
assert.match(aiSettings, /value="controlled_autopilot"/)
assert.match(aiSettings, /Approved business information/)
assert.match(aiSettings, /\/ai\/settings\/approve/)
assert.match(aiSettings, /\/ai\/knowledge\/approve/)
assert.match(aiSettings, /\/ai\/emergency-pause/)
assert.match(aiSettings, /cannot be enabled until the configuration and business information are separately approved/)

const onboarding = read("app/app/onboarding/page.tsx")
assert.match(onboarding, /Step \{step \+ 1\} of \{steps\.length\}/)
assert.match(onboarding, /We run a controlled test lead/)
assert.match(onboarding, /Open connections/)
assert.doesNotMatch(onboarding, /Zillow/i)

const integrations = read("app/app/integrations/page.tsx")
assert.match(integrations, /Twilio and SendGrid are managed by RealtyTechAI/)
assert.match(integrations, /Assigned sending number/)
assert.match(integrations, /Assigned sender/)
assert.doesNotMatch(integrations, /Save Twilio|Save SendGrid|Account SID|Auth Token|SendGrid API key/)
assert.doesNotMatch(integrations, /platformProviderSetupEnabled\s*=\s*false/)
assert.doesNotMatch(integrations, /Zillow/i)

const managedIntegrations = read("components/admin/managed-integrations.tsx")
assert.match(managedIntegrations, /Managed messaging integrations/)
assert.match(managedIntegrations, /Platform Twilio/)
assert.match(managedIntegrations, /Platform SendGrid/)
assert.match(managedIntegrations, /\/admin\/platform-integrations\/twilio/)
assert.match(managedIntegrations, /\/admin\/platform-integrations\/sendgrid/)
assert.match(managedIntegrations, /\/admin\/tenants\/\$\{tenantId\}\/integrations\/twilio/)
assert.match(managedIntegrations, /\/admin\/tenants\/\$\{tenantId\}\/integrations\/sendgrid/)
const adminNavigation = read("components/admin/admin-navigation.ts")
const adminDashboard = read("app/admin/dashboard/admin-dashboard-client.tsx")
assert.match(adminNavigation, /id: "settings", label: "Settings", ownerOnly: true/)
assert.match(adminDashboard, /<ManagedIntegrations \/>/)
assert.match(read("app/admin/integrations/page.tsx"), /redirect\("\/admin\/dashboard\?view=settings"\)/)

const sidebar = read("components/app-shell/sidebar.tsx")
assert.match(sidebar, /label: "Help", href: "\/support"/)
assert.match(sidebar, /label: "Today"/)
assert.match(sidebar, /label: "Appointments"/)
assert.equal((sidebar.match(/label:/g) || []).length, 6, "client navigation should stay limited to six choices")
assert.doesNotMatch(sidebar, /Teams Plan|Enterprise|Upgrade/)

const today = read("app/app/dashboard/page.tsx")
assert.match(today, /\/client\/today\?limit=8/)
assert.match(today, /Who needs you, why, and what to do next/)
assert.match(today, /Do this next/)
assert.doesNotMatch(today, /DashboardKpis|recharts|provider accepted|webhook|automation logic/i)

const appointments = read("app/app/appointments/page.tsx")
assert.match(appointments, /\/client\/appointments/)
assert.match(appointments, /Schedule appointment/)
assert.match(appointments, /Reschedule/)

const admin = [
  read("app/admin/dashboard/page.tsx"),
  adminDashboard,
  adminNavigation,
  read("components/admin/service-control-dialog.tsx"),
].join("\n")
assert.match(admin, /\/admin\/applications\?take=100/)
assert.match(admin, /\/admin\/operations\?take=100/)
assert.match(admin, /\/support\/admin\/tickets/)
assert.match(admin, /Action required/)
assert.match(admin, /\/admin\/client-operations\/handoffs/)
assert.match(admin, /\/admin\/client-operations\/appointments/)
assert.match(admin, /id: "billing", label: "Billing", ownerOnly: true/)
assert.match(admin, /id: "health", label: "System health", ownerOnly: true/)
assert.match(admin, /\/admin\/ai\/overview/)
assert.match(admin, /\/admin\/ai\/emergency-pause/)
assert.match(admin, /Global AI control/)
assert.match(admin, /Manual messaging,[\s\S]*inboxes,\s*leads, and appointments remain available/)
assert.doesNotMatch(admin, /window\.prompt/)
assert.doesNotMatch(admin, /window\.confirm/)

const notifications = read("components/admin/notification-center.tsx")
assert.match(notifications, /Notification\.requestPermission\(\)/)
assert.match(notifications, /serviceWorker\.register\("\/sw\.js"/)
assert.match(notifications, /basePath.*push\/subscriptions/s)
assert.match(notifications, /audience.*client/)
assert.match(notifications, /Filter notifications by category/)
assert.match(notifications, /Quiet hours/)
const worker = read("public/sw.js")
assert.match(worker, /notificationclick/)
assert.match(worker, /clients\.openWindow/)
assert.match(worker, /requestedUrl\.startsWith\("\/app"\)/)
assert.doesNotMatch(worker, /https?:\/\/[^"']+/)

const layout = read("app/layout.tsx")
assert.match(layout, /tech-20house-20logo-20with-20circuit-20lines\.png/)

const billing = read("app/app/billing/page.tsx")
assert.match(billing, /There are no plan choices/)
assert.doesNotMatch(billing, /Choose Pro|Choose Teams|Upgrade/)

const flatServicePages = [
  "app/faq/page.tsx",
  "app/app/inbox/page.tsx",
  "app/app/routing/page.tsx",
  "app/app/team/page.tsx",
  "app/app/compliance/page.tsx",
  "app/app/reports/page.tsx",
]
  .map(read)
  .join("\n")
assert.doesNotMatch(flatServicePages, /Teams plan|Enterprise plan|Upgrade to|See plans/)
assert.match(admin, /Recent payment activity/)

console.log(`Client-readiness frontend verification passed (${links.length} static links checked).`)
