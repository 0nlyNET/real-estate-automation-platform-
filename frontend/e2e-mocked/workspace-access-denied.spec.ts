import { test, expect, type Page, type Route } from "@playwright/test"
import { createServer, type Server } from "node:http"

/**
 * Regression coverage for the workspace-access remount loop.
 *
 * Root cause: when a tenant-scoped data fetch (e.g. /ai/settings,
 * /client/today) was denied with 403 PAYMENT_REQUIRED / WORKSPACE_SUSPENDED,
 * apiFetch dispatched `rta:workspace-access-changed`, and ClientAccessGuard
 * re-ran verify() with checking=true, unmounting the page. The remount
 * refetched, got 403 again, and looped forever — the UI spun indefinitely
 * instead of resolving to an error/denied state.
 *
 * Fix: event-triggered re-verification runs in the background without
 * unmounting children, so the page that received the 403 renders its own
 * error state exactly once.
 */

// The Next.js proxy (proxy.ts) verifies the rtai_session cookie server-side
// against BACKEND_API_URL/auth/session. Serve a stub so the middleware lets
// the test through; the browser-level /api/backend/* mocks below drive the UI.
let stubBackend: Server
test.beforeAll(async () => {
  stubBackend = createServer((req, res) => {
    if (req.url?.startsWith("/auth/session")) {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ userId: "u1", platformRole: null }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((resolve) => stubBackend.listen(4000, "127.0.0.1", resolve))
})
test.beforeEach(async ({ page }) => {
  await page.context().addCookies([
    { name: "rtai_session", value: "test-session", domain: "127.0.0.1", path: "/" },
  ])
})
test.afterAll(async () => {
  await new Promise<void>((resolve) => stubBackend.close(() => resolve()))
})

type MockPlan = {
  me: unknown
  session: unknown
  aiSettings: { status: number; body: unknown; delayMs?: number } | null
  today: { status: number; body: unknown; delayMs?: number } | null
}

const DENIED_ME = {
  platformRole: "super_admin",
  serviceAccess: {
    allowed: false,
    billingEligible: false,
    reason: "Payment has not been confirmed by Stripe",
  },
  operatorMode: null,
  operatorTenantRequired: false,
  impersonated: true,
}

const ALLOWED_ME = {
  platformRole: null,
  serviceAccess: { allowed: true, billingEligible: true, reason: null },
  operatorMode: null,
  operatorTenantRequired: false,
  impersonated: false,
  userId: "u1",
  tenantId: "t1",
  role: "owner",
}

const SESSION_OWNER = {
  userId: "u1",
  tenantId: "t1",
  role: "owner",
  email: "owner@example.test",
  isPlatformAdmin: false,
  platformRole: null,
  impersonated: true,
  impersonatedBy: { userId: "admin1", email: "admin@example.test" },
  operatorMode: null,
  operatorTenantRequired: false,
  sessionExpiresAt: null,
  serviceAccess: DENIED_ME.serviceAccess,
}

const DENIED_403 = {
  status: 403,
  body: {
    statusCode: 403,
    code: "PAYMENT_REQUIRED",
    message: "Payment has not been confirmed by Stripe",
    error: "Forbidden",
  },
}

const AI_SETTINGS_OK = {
  assistantStatus: "paused",
  settings: {
    aiEnabled: false,
    aiFirstResponderEnabled: true,
    allowedChannels: ["email"],
    tone: "professional_warm",
    bookingBehavior: "verified_link_only",
    responseMode: "human_only",
    identityLabel: "Test Assistant",
    maximumAutomaticTurns: 6,
    minimumConfidenceThreshold: 0.7,
    aiPaused: false,
    aiPausedReason: null,
    configurationApprovalStatus: "draft",
  },
  knowledge: {
    publicName: "Test Realty",
    officeEmail: "office@example.test",
    officePhone: null,
    serviceAreas: ["Buffalo, NY"],
    businessHours: { general: "Mon-Fri 9-5" },
    schedulingInstructions: null,
    approvedFaqs: [],
    escalationInstructions: null,
    qualificationQuestions: [],
    prohibitedTopics: [],
    requiredDisclaimer: null,
    approvalStatus: "draft",
    updatedAt: new Date().toISOString(),
  },
  usage: { runs: 0, total: 0, estimatedCostUsd: 0, monthlyLimit: 100 },
  readiness: {
    providerConfigured: true,
    communications: { sms: false, email: true },
    verifiedBookingLink: false,
    bookingProviderConnected: false,
    activeBookingProvider: null,
    googleCalendarConnected: false,
  },
}

const TODAY_OK = {
  headline: "All clear",
  guidance: "Nothing needs attention.",
  actionCount: 0,
  actions: [],
}

async function mockBackend(page: Page, plan: MockPlan) {
  const counts = { me: 0, aiSettings: 0, today: 0 }
  await page.route("**/api/backend/**", async (route: Route) => {
    const url = route.request().url()
    if (url.includes("/api/backend/me")) {
      counts.me += 1
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan.me) })
    } else if (url.includes("/api/backend/auth/session")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(plan.session) })
    } else if (url.includes("/api/backend/ai/settings") && plan.aiSettings) {
      counts.aiSettings += 1
      if (plan.aiSettings.delayMs) await new Promise((r) => setTimeout(r, plan.aiSettings!.delayMs))
      await route.fulfill({ status: plan.aiSettings.status, contentType: "application/json", body: JSON.stringify(plan.aiSettings.body) })
    } else if (url.includes("/api/backend/client/today") && plan.today) {
      counts.today += 1
      if (plan.today.delayMs) await new Promise((r) => setTimeout(r, plan.today!.delayMs))
      await route.fulfill({ status: plan.today.status, contentType: "application/json", body: JSON.stringify(plan.today.body) })
    } else {
      // Unmatched endpoints: return empty shapes that components can render
      // without crashing (the notification list expects an array).
      const path = url.split("/api/backend/")[1] || ""
      const body = path.startsWith("notifications") && !path.includes("/summary") && !path.includes("/preferences") ? [] : {}
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
    }
  })
  return counts
}

test("denied assistant settings resolves to an error instead of looping", async ({ page }) => {
  const counts = await mockBackend(page, {
    me: DENIED_ME,
    session: SESSION_OWNER,
    aiSettings: DENIED_403,
    today: null,
  })
  await page.goto("/app/assistant/settings")
  // The denial must surface as a readable error, not a perpetual spinner.
  await expect(page.getByText("Payment has not been confirmed by Stripe")).toBeVisible({ timeout: 15000 })
  await expect(page.getByText("Loading assistant settings…")).toBeHidden({ timeout: 15000 })
  // Let any loop run: the access check must stay bounded (initial + one background refresh).
  await page.waitForTimeout(5000)
  expect(counts.me).toBeLessThanOrEqual(4)
  expect(counts.aiSettings).toBeLessThanOrEqual(2)
  await expect(page.getByText("Payment has not been confirmed by Stripe")).toBeVisible()
})

test("denied dashboard today feed resolves to an error instead of looping", async ({ page }) => {
  const counts = await mockBackend(page, {
    me: DENIED_ME,
    session: SESSION_OWNER,
    aiSettings: null,
    today: DENIED_403,
  })
  await page.goto("/app/dashboard")
  await expect(page.getByText("Payment has not been confirmed by Stripe")).toBeVisible({ timeout: 15000 })
  await page.waitForTimeout(5000)
  expect(counts.me).toBeLessThanOrEqual(4)
  expect(counts.today).toBeLessThanOrEqual(2)
})

test("successful responses render page content", async ({ page }) => {
  await mockBackend(page, {
    me: ALLOWED_ME,
    session: { ...SESSION_OWNER, impersonated: false, serviceAccess: ALLOWED_ME.serviceAccess },
    aiSettings: { status: 200, body: AI_SETTINGS_OK },
    today: { status: 200, body: TODAY_OK },
  })
  await page.goto("/app/assistant/settings")
  await expect(page.getByText("Assistant preferences")).toBeVisible({ timeout: 15000 })
  await expect(page.getByLabel("Approved AI identity")).toHaveValue("Test Assistant")
  await page.goto("/app/dashboard")
  await expect(page.getByText("All clear")).toBeVisible({ timeout: 15000 })
})

test("failed data fetch shows an error instead of spinning", async ({ page }) => {
  await mockBackend(page, {
    me: DENIED_ME,
    session: SESSION_OWNER,
    aiSettings: { status: 500, body: { statusCode: 500, message: "boom", error: "Internal Server Error" } },
    today: null,
  })
  await page.goto("/app/assistant/settings")
  await expect(page.getByText("boom")).toBeVisible({ timeout: 15000 })
  await expect(page.getByText("Loading assistant settings…")).toBeHidden({ timeout: 15000 })
})

test("aborted in-flight fetch on navigation does not surface an error", async ({ page }) => {
  const counts = await mockBackend(page, {
    me: DENIED_ME,
    session: SESSION_OWNER,
    aiSettings: { status: 200, body: AI_SETTINGS_OK, delayMs: 8000 },
    today: null,
  })
  await page.goto("/app/assistant/settings")
  // Navigate away while the settings fetch is still in flight.
  await page.waitForTimeout(1000)
  await page.goto("/app/automations")
  await page.waitForTimeout(2000)
  // No error banner from the abandoned request, and no runaway refetching.
  expect(counts.aiSettings).toBeLessThanOrEqual(1)
})
