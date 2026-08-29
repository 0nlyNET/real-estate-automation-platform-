import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

const page = read("app/admin/dashboard/page.tsx")
const dashboard = read("app/admin/dashboard/admin-dashboard-client.tsx")
const adminIndex = read("app/admin/page.tsx")
const legacyOverview = read("app/admin/overview/page.tsx")
const legacyIntegrations = read("app/admin/integrations/page.tsx")
const legacySalesBooking = read("app/admin/sales-booking/page.tsx")
const layout = read("app/admin/layout.tsx")
const guard = read("app/admin/admin-access-guard.tsx")
const navigation = read("components/admin/admin-navigation.ts")
const shell = read("components/admin/admin-shell.tsx")
const serviceDialog = read("components/admin/service-control-dialog.tsx")
const adminSource = [page, dashboard, layout, guard, navigation, shell, serviceDialog].join("\n")

// Canonical routing and retired entry points.
assert.match(adminIndex, /redirect\("\/admin\/dashboard"\)/, "/admin must redirect to the canonical dashboard")
assert.match(
  legacyOverview,
  /redirect\("\/admin\/dashboard"\)/,
  "/admin/overview must redirect to the canonical dashboard",
)
assert.match(
  legacyIntegrations,
  /redirect\("\/admin\/dashboard\?view=settings"\)/,
  "legacy integrations must enter canonical settings",
)
assert.match(
  legacySalesBooking,
  /redirect\("\/admin\/dashboard\?view=settings"\)/,
  "legacy booking settings must enter canonical settings",
)
assert.match(page, /AdminDashboardClient/, "the canonical route must render the consolidated dashboard")
assert.match(page, /searchParams: Promise</, "Next 16 search params must use the asynchronous contract")
assert.doesNotMatch(
  adminSource,
  /router\.replace\("\/admin\/overview"|fullOperations|full=1/,
  "nothing may return to the retired dashboard",
)
assert.doesNotMatch(
  shell,
  /href=["']\/admin\/(overview|integrations|sales-booking)/,
  "admin navigation must not link to retired routes",
)

// Role-aware information architecture.
const primaryBlock = navigation.match(/primaryAdminNavigation[\s\S]*?= \[([\s\S]*?)\n\]/)?.[1] || ""
const secondaryBlock = navigation.match(/secondaryAdminNavigation[\s\S]*?= \[([\s\S]*?)\n\]/)?.[1] || ""
assert.equal(
  (primaryBlock.match(/id:/g) || []).length,
  6,
  "primary admin navigation must contain exactly six destinations",
)
for (const label of ["Overview", "Clients", "Leads", "Onboarding", "Tasks", "Support"]) {
  assert.match(primaryBlock, new RegExp(`label: "${label}"`), `primary navigation must include ${label}`)
}
assert.equal((secondaryBlock.match(/ownerOnly: true/g) || []).length, 4, "all four secondary tools must be owner-only")
for (const label of ["Billing", "System health", "Audit log", "Settings"]) {
  assert.match(secondaryBlock, new RegExp(`label: "${label}"`), `owner navigation must include ${label}`)
}
assert.match(shell, /isOwner \? \(/, "owner tools must be conditionally rendered")
assert.match(dashboard, /!isOwner && ownerViews\.has/, "staff must be redirected away from owner-only views")
assert.doesNotMatch(
  dashboard,
  /fetchMe/,
  "the dashboard must reuse the access guard session instead of duplicating the session request",
)

// Responsive shell, global header, and keyboard-accessible primitives.
assert.match(shell, /<aside[\s\S]*hidden[\s\S]*lg:flex/, "desktop navigation must use a sidebar")
assert.match(shell, /<SheetContent side="left"/, "mobile navigation must use a compact drawer")
assert.match(shell, /aria-label="Open admin navigation"/, "mobile navigation needs an accessible name")
assert.match(shell, /focus-visible:ring-2/, "navigation links must retain visible keyboard focus")
assert.match(dashboard, /role="search"/, "the dashboard header must expose global search")
assert.match(dashboard, /<NotificationCenter \/>/, "the header must include notifications")
assert.match(dashboard, /Quick action/, "the header must expose one quick-action menu")
assert.match(
  dashboard,
  /<Tabs[\s\S]*<TabsTrigger/,
  "client and settings tabs must use keyboard-accessible tab primitives",
)

// Five-second operational overview.
assert.equal((dashboard.match(/<SummaryCard/g) || []).length, 4, "overview must render no more than four summary cards")
assert.match(dashboard, /Action required/, "the priority action list must be the main overview section")
assert.match(dashboard, /\.slice\(0, 8\)/, "the overview must cap priority work at eight rows")
assert.match(dashboard, /recentActivity[\s\S]*\.slice\(0, 5\)/, "recent activity must remain compact")
assert.match(dashboard, /Platform operating normally/, "the overview must show a compact healthy state")
assert.match(dashboard, /Automated lead AI is paused/, "the overview must surface the platform lead-AI pause")
assert.match(dashboard, /Message delivery is degraded/, "the overview must surface delivery degradation")
assert.doesNotMatch(
  dashboard,
  /recharts|Eight-week pipeline trend|Business flow|Last 30 days/,
  "overview analytics and decorative flow widgets must be removed",
)

// Client queue and one consistent client workspace.
for (const filter of [
  "needs_attention",
  "active",
  "setup_incomplete",
  "payment_overdue",
  "suspended",
  "integration_issue",
]) {
  assert.match(dashboard, new RegExp(`value="${filter}"`), `clients must support the ${filter} filter`)
}
for (const column of [
  "Client",
  "Service",
  "Onboarding",
  "Lead source",
  "Payment",
  "Last activity",
  "Assigned staff",
  "Action",
]) {
  assert.match(dashboard, new RegExp(`TableHead[^>]*>${column}<`), `client table must include ${column}`)
}
const clientTabBlock = dashboard.match(/const clientTabs[\s\S]*?= \[([\s\S]*?)\n\]/)?.[1] || ""
assert.equal((clientTabBlock.match(/id:/g) || []).length, 7, "client workspace must contain at most seven tabs")
assert.match(clientTabBlock, /id: "billing", label: "Billing", ownerOnly: true/, "billing must be hidden from staff")
assert.match(
  dashboard,
  /switchView\("clients", tenant\.id, "overview"\)/,
  "client rows must open the same client workspace",
)
assert.match(dashboard, /clientTab !== "appointments"/, "appointments must lazy-load only inside the client workspace")

// Lead, onboarding, task, and support workflows.
for (const filter of [
  "new",
  "requires_response",
  "appointment_scheduled",
  "follow_up_due",
  "paused",
  "opted_out",
  "lost",
]) {
  assert.match(dashboard, new RegExp(`value="${filter}"`), `leads must support the ${filter} filter`)
}
for (const column of ["Lead", "Source", "Stage", "Communication", "Next action", "Last contact"]) {
  assert.match(dashboard, new RegExp(`TableHead[^>]*>${column}<`), `lead table must include ${column}`)
}
assert.equal(
  (
    dashboard.match(
      /label: "(?:Account created|Business information completed|Branding completed|Lead source and CRM connected|Appointment provider connected and tested|Message settings approved|Controlled workflow completed|Launch approved)"/g,
    ) || []
  ).length,
  8,
  "onboarding must group progress into eight plain-language steps",
)
for (const status of ["Not started", "In progress", "Blocked", "Ready for review", "Complete"]) {
  assert.match(dashboard, new RegExp(status), `onboarding must expose the ${status} state`)
}
assert.match(
  dashboard,
  /Related client[\s\S]*Owner[\s\S]*Priority[\s\S]*Due date[\s\S]*Status/,
  "tasks must expose operational columns",
)
assert.match(
  dashboard,
  /Request[\s\S]*Client[\s\S]*Category[\s\S]*Priority[\s\S]*Owner[\s\S]*Age[\s\S]*Status/,
  "support must expose operational columns",
)

// Suspension and restoration safety.
assert.match(serviceDialog, /Stops automated SMS and email/)
assert.match(serviceDialog, /Stops sequences and reminders/)
assert.match(serviceDialog, /Preserves client and lead data/)
assert.match(serviceDialog, /Preserves conversations and history/)
assert.match(serviceDialog, /Suspension reason/)
assert.match(serviceDialog, /reason\.trim\(\)\.length < 3/, "suspension must require a reason")
assert.match(dashboard, /body: \{ reason \}/, "the entered reason must be sent to the backend")
assert.match(dashboard, /setSelectedTenant\(updated\)/, "service state must update immediately after success")
assert.match(dashboard, /Client services suspended/, "suspension success must be visible")
assert.match(dashboard, /Client services restored/, "restoration success must be visible")
assert.match(
  dashboard,
  /serviceSuspendedById[\s\S]*serviceSuspensionReason[\s\S]*serviceSuspendedAt/,
  "the suspended banner must retain actor, reason, and time",
)
assert.doesNotMatch(adminSource, /window\.confirm|window\.prompt/, "high-impact actions must use accessible dialogs")

// Loading, empty, error, mobile, and API-failure handling.
assert.match(dashboard, /Promise\.allSettled\(sections\.map/, "independent data failures must not block the workspace")
assert.match(dashboard, /loadedSections/, "data sections must be cached instead of re-fetched by every widget")
assert.match(dashboard, /SectionFailures/, "failed sections must expose focused retry actions")
assert.match(
  dashboard,
  /LoadingTable|LoadingRows|OverviewSkeleton/,
  "major workflows must have skeleton loading states",
)
assert.match(dashboard, /EmptyState/, "major workflows must have explicit empty states")
assert.match(dashboard, /role="alert"/, "errors must be announced accessibly")
assert.match(dashboard, /md:hidden/, "high-use tables must have mobile layouts")
assert.match(dashboard, /hidden md:block/, "desktop tables must not be forced onto small screens")
assert.match(dashboard, /aria-label="Filter clients by status"/, "filters must have accessible names")

console.log("Admin dashboard UX and routing regression checks passed.")
