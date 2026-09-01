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
assert.match(read("app/logout/page.tsx"), /method: "POST"/)
const sessionExpiry = read("components/session-expiry-redirect.tsx")
assert.match(sessionExpiry, /addEventListener\("rta:session-expired"/)
assert.match(sessionExpiry, /\/login\?reason=session_expired/)
assert.match(read("app/login/page.tsx"), /Your session expired or was revoked/)
const proxySource = read("proxy.ts")
assert.doesNotMatch(proxySource, /decodePayload|token\.split|\batob\b/)
assert.match(proxySource, /fetch\(`\$\{backend\}\/me`/)
assert.match(proxySource, /session\.platformRole/)
assert.match(read("app/api/backend/[...path]/route.ts"), /BACKEND_API_URL/)
assert.match(read("next.config.mjs"), /Content-Security-Policy/)
assert.match(read("next.config.mjs"), /frame-ancestors 'none'/)
const verifyEmail = read("app/verify-email/verify-email-client.tsx")
assert.match(verifyEmail, /apiFetch\("\/auth\/verify-email"/)
assert.match(verifyEmail, /method: "POST"/)
assert.match(verifyEmail, /body: \{ token \}/)
assert.doesNotMatch(verifyEmail, /verify-email\?token=/)
assert.equal(existsSync(join(root, "app/verify-email/verify-email-inner.tsx")), false, "dead verification client must not return")
const resetPassword = read("app/reset-password/reset-password-client.tsx")
assert.match(resetPassword, /apiFetch\("\/auth\/reset-password"/)
assert.match(resetPassword, /body: \{ token, password \}/)
assert.match(resetPassword, /password !== confirmation/)
assert.equal(existsSync(join(root, "app/reset-password/reset-password-inner.tsx")), false, "dead password-reset client must not return")

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
assert.match(inbox, /channel: replyChannel/)
assert.match(inbox, /switch the conversation to\s+human handling/)
assert.match(inbox, /Provider accepted/)
assert.match(inbox, /Delivered/)
assert.match(inbox, /Failed/)
assert.match(inbox, /Shared/)
assert.match(inbox, /Assigned to me/)
assert.match(inbox, /requestId: crypto\.randomUUID\(\)/)
assert.match(inbox, /queued for delivery\. Provider status will update here automatically/)
assert.match(inbox, /Retry the same message safely/)
assert.match(inbox, /Retry as a new message/)
assert.match(inbox, /sendFailures/)
assert.match(inbox, /activeLeadIdRef\.current !== leadId/)
assert.match(inbox, /loadedLeadId === activeLeadId/)
assert.match(inbox, /event\.key === "Enter"/)
assert.match(inbox, /!event\.shiftKey/)
assert.match(inbox, /!event\.nativeEvent\.isComposing/)
assert.match(inbox, /includeMeta: "1"/)
assert.match(inbox, /query\.set\("changedAfter"/)
assert.match(inbox, /query\.set\("before"/)
assert.match(inbox, /Load earlier messages/)
assert.match(inbox, /Load more conversations/)
assert.match(inbox, /document\.visibilityState === "visible"/)
assert.match(inbox, /conversationRequestsInFlight/)
assert.match(inbox, /threadRequestVersion/)
assert.match(inbox, /mode === "initial"[\s\S]*\/enrollments/)
assert.doesNotMatch(inbox, /Message sent/)
assert.doesNotMatch(inbox, /webhook/i)

const inboxPreview = read("components/dashboard/inbox-preview.tsx")
assert.match(inboxPreview, /t\.lastMessageBody/)
assert.match(inboxPreview, /inbox\?leadId=/)
assert.doesNotMatch(inboxPreview, /lastMessagePreview|unreadCount/)

const conversationControls = read("components/ai/conversation-controls.tsx")
assert.match(conversationControls, /Take Over/)
assert.match(conversationControls, /Return to AI/)
assert.match(conversationControls, /window\.confirm/)
assert.match(conversationControls, /drafts\/\$\{draft\.id\}\/approve/)
assert.match(conversationControls, /drafts\/\$\{draft\.id\}\/edit-and-send/)
assert.match(conversationControls, /drafts\/\$\{draft\.id\}\/reject/)
assert.match(conversationControls, /AI-generated summary/)
assert.match(conversationControls, /AI queued/)
assert.match(conversationControls, /AI processing/)
assert.match(conversationControls, /Human review/)
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
assert.match(onboarding, /Owner: \{item\.responsibleParty/)
assert.match(onboarding, /item\.nextAction/)
assert.doesNotMatch(onboarding, /Zillow/i)

const integrations = read("app/app/integrations/page.tsx")
assert.match(integrations, /Twilio and SendGrid are managed by RealtyTechAI/)
assert.match(integrations, /Assigned sending number/)
assert.match(integrations, /Assigned sender/)
assert.doesNotMatch(integrations, /Save Twilio|Save SendGrid|Account SID|Auth Token|SendGrid API key/)
assert.doesNotMatch(integrations, /platformProviderSetupEnabled\s*=\s*false/)
assert.doesNotMatch(integrations, /Zillow/i)
assert.match(integrations, /new URLSearchParams\(window\.location\.search\)/)
assert.match(integrations, /\$\{label\} authorization complete/)
assert.match(integrations, /Facebook authorization complete/)
assert.match(integrations, /window\.history\.replaceState/)

const managedIntegrations = read("components/admin/managed-integrations.tsx")
assert.match(managedIntegrations, /Managed messaging integrations/)
assert.match(managedIntegrations, /Platform Twilio/)
assert.match(managedIntegrations, /Platform SendGrid/)
assert.match(managedIntegrations, /\/admin\/platform-integrations\/twilio/)
assert.match(managedIntegrations, /\/admin\/platform-integrations\/sendgrid/)
assert.match(managedIntegrations, /\/admin\/tenants\/\$\{tenantId\}\/integrations\/twilio/)
assert.match(managedIntegrations, /\/admin\/tenants\/\$\{tenantId\}\/integrations\/sendgrid/)
assert.match(managedIntegrations, /\/admin\/tenants\/\$\{tenantId\}\/provisioning\/reconcile/)
assert.match(managedIntegrations, /provisioning\/twilio-compliance/)
assert.match(managedIntegrations, /Provision \/ reconcile managed providers/)
assert.doesNotMatch(managedIntegrations, /tenantFromEmail|tenantInboundAddress|Save assignment/)
const adminNavigation = read("components/admin/admin-navigation.ts")
const adminDashboard = read("app/admin/dashboard/admin-dashboard-client.tsx")
assert.match(adminNavigation, /id: "settings", label: "Settings", ownerOnly: true/)
assert.match(adminDashboard, /<ManagedIntegrations \/>/)
assert.match(adminDashboard, /Controlled end-to-end test/)
assert.match(adminDashboard, /Provider-failure visibility test/)
assert.match(adminDashboard, /Twilio external approval/)
assert.match(adminDashboard, /SendGrid external verification/)
assert.match(read("app/admin/integrations/page.tsx"), /redirect\("\/admin\/dashboard\?view=settings"\)/)

const sidebar = read("components/app-shell/sidebar.tsx")
assert.match(sidebar, /label: "Help", href: "\/support"/)
assert.match(sidebar, /label: "Today"/)
assert.match(sidebar, /label: "Appointments"/)
assert.match(sidebar, /label: "AI assistant", href: "\/app\/assistant"/)
assert.equal((sidebar.match(/label:/g) || []).length, 7, "client navigation should stay limited to seven focused choices")
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
assert.match(admin, /\/admin\/operations\/exceptions/)
assert.match(admin, /\/admin\/setup-checker/)
assert.match(admin, /\/testing\/run/)
assert.match(admin, /Provider callbacks and controlled test runs record technical evidence automatically/)
assert.match(admin, /\/support\/admin\/tickets/)
assert.match(admin, /Action required/)
assert.match(admin, /\/admin\/client-operations\/handoffs/)
assert.match(admin, /\/admin\/client-operations\/appointments/)
assert.match(admin, /id: "billing", label: "Billing", ownerOnly: true/)
assert.match(admin, /id: "health", label: "System health", ownerOnly: true/)
assert.match(admin, /\/admin\/ai\/overview/)
assert.match(admin, /\/admin\/ai\/emergency-pause/)
assert.match(admin, /Global AI control/)
assert.match(admin, /Global automations safety switch/)
assert.match(admin, /GLOBAL_AUTOMATIONS_DISABLED/)
assert.match(admin, /Platform AI emergency pause/)
assert.match(admin, /will not automatically return[\s\S]*conversations to AI handling/)
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
assert.match(billing, /billing\?\.stripeSubscriptionStatus/)
assert.match(billing, /new URLSearchParams\(window\.location\.search\)/)
assert.match(billing, /Checkout was canceled and no payment was submitted/)
assert.match(billing, /Billing status could not be loaded/)
assert.match(billing, /A workspace owner or administrator must manage billing/)
assert.match(billing, /canManage !== true/)
assert.doesNotMatch(read("lib/plan.ts"), /catch\s*\{[\s\S]*return null/)
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
