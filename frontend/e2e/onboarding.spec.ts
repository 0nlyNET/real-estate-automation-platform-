import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"

const requireBackend = createRequire(join(process.cwd(), "../backend/package.json"))
const { Client } = requireBackend("pg")
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['cookies']>>>()
const failedResponses = new WeakMap<Page, string[]>()

function accounts(): { password: string; tenantId: string; conversationTenantId: string; conversationLeadId: string } {
  return JSON.parse(
    readFileSync(join(process.cwd(), ".e2e/accounts.json"), "utf8"),
  )
}

test.beforeEach(async ({ page }) => {
  const failures: string[] = []
  failedResponses.set(page, failures)
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`)
  })
})

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    console.log("Failed browser view", await page.locator("body").innerText())
    console.log("Failed browser responses", failedResponses.get(page))
    const session = await page.request.get("/api/backend/auth/session")
    console.log("Failed browser session check", session.status(), session.headers()["retry-after"] || null)
  }
})

async function login(page: Page, email: string) {
  const saved = sessions.get(email)
  if (saved) {
    await page.context().addCookies(saved)
    return
  }
  await page.goto("/login")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(accounts().password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page).toHaveURL(
    email.includes("client") ? /\/app\// : /\/admin\/dashboard/,
  )
  sessions.set(email, await page.context().cookies())
}

async function openOnboarding(page: Page) {
  await page.goto(
    `/admin/dashboard?view=onboarding&tenantId=${accounts().tenantId}`,
  )
  await expect(page.getByText("Guided setup", { exact: true })).toBeVisible()
}

test("owner can create and revoke a recipient-scoped email grant without changing billing", async ({ page }) => {
  await login(page, "browser-owner@example.test")
  const tenantsPath = "/api/backend/admin/tenants"
  const before = await (await page.request.get(tenantsPath)).json()
  const original = before.find((tenant: { id: string }) => tenant.id === accounts().tenantId)
  expect(original).toBeTruthy()
  expect(original.status).toBe("active")
  await page.goto(`/admin/dashboard?view=clients&tenantId=${accounts().tenantId}&clientTab=overview`)
  const panel = page.getByRole("region", { name: "Operator email test", exact: true })
  await expect(panel).toBeVisible()
  await panel.getByLabel("Test recipient email", { exact: true }).fill("operator-recipient@example.test")
  await panel.getByLabel("Test purpose", { exact: true }).fill("Browser operator acceptance")
  const create = panel.getByRole("button", { name: "Create 24-hour email test grant", exact: true })
  await expect(create).toBeDisabled()
  await panel.getByRole("checkbox").check()
  await expect(create).toBeEnabled()
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll("body *")].filter((element) => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.right > document.documentElement.clientWidth + 1
    }).map((element) => ({ tag: element.tagName, classes: element.className, text: element.textContent?.slice(0,100), right: element.getBoundingClientRect().right })).slice(-25),
  }))
  if (layout.scrollWidth > layout.width + 1) console.log("Client workspace overflow", layout)
  expect(layout.scrollWidth <= layout.width + 1).toBe(true)
  try {
    await create.click({ timeout: 15_000 })
  } catch (error) {
    console.log("Grant button hit-test", await create.evaluate((button) => {
      const box = button.getBoundingClientRect()
      return { box: box.toJSON(), viewport: { width: innerWidth, height: innerHeight, scale: visualViewport?.scale },
        pointerEvents: getComputedStyle(button).pointerEvents,
        hit: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.outerHTML.slice(0,1000) }
    }))
    throw error
  }
  await expect(panel.getByRole("status")).toContainText("Email test grant created")
  const grants = await (await page.request.get(`/api/backend/admin/operator-test/grants/${accounts().tenantId}`)).json()
  const grant = grants.find((entry: { isRevoked: boolean; recipientAllowlist: string[] }) => !entry.isRevoked && entry.recipientAllowlist.includes("operator-recipient@example.test"))
  expect(grant).toMatchObject({ tenantId: accounts().tenantId, recipientAllowlist: ["operator-recipient@example.test"], dailyLimit: 5, totalLimit: 10 })
  expect(new Date(grant.expiresAt).getTime() - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000)
  expect(new Date(grant.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
  const after = await (await page.request.get(tenantsPath)).json()
  expect(after.find((tenant: { id: string }) => tenant.id === accounts().tenantId).status).toBe(original.status)
  await panel.getByRole("button", { name: "Revoke grant", exact: true }).click()
  await expect(panel.getByRole("status")).toContainText("Grant revoked")
  const revoked = await (await page.request.get(`/api/backend/admin/operator-test/grants/${accounts().tenantId}`)).json()
  expect(revoked.find((entry: { id: string }) => entry.id === grant.id).isRevoked).toBe(true)
})

test("owner sees honest readiness, disabled testing, and a responsive workspace without runtime errors", async ({
  page,
}) => {
  const errors: string[] = []
  const failedRequests: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("response", (response) => {
    if (response.url().includes("/api/backend/") && response.status() >= 400)
      failedRequests.push(`${response.status()} ${response.url()}`)
  })
  await login(page, "browser-owner@example.test")
  await openOnboarding(page)
  await expect(page.getByText(/^Not launch ready$/i)).toBeVisible()
  await expect(page.getByText(/^100% onboarded$/i)).toHaveCount(0)
  await expect(
    page.getByText("Inbound replies tested", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "Send test lead", exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "Activate services", exact: true }),
  ).toBeDisabled()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true)
  await page
    .getByRole("button", { name: "Open client workspace", exact: true })
    .click()
  // Operator mode enters the tenant-facing /app/* workspace (not the admin client view)
  await expect(page).toHaveURL(/\/app\/dashboard/)
  // Operator-mode banner is visible with the selected tenant name
  const operatorBanner = page.getByRole("banner", { name: "Operator mode active" });
  // Exactly one global operator banner (dedupe guard: AppShell must not render
  // a second copy inside /app layout).
  await expect(operatorBanner).toHaveCount(1);
  await expect(operatorBanner).toBeVisible();
  // Tenant name is rendered inside the banner text (not as an exact standalone
  // match), so scope the assertion to the banner and use substring matching.
  await expect(operatorBanner).toContainText("Browser pending workspace");
  // Tenant-facing dashboard loads without errors
  expect(errors).toEqual([])
  expect(failedRequests).toEqual([])
  // Exit Operator Mode restores the platform-admin session
  await page
    .getByRole("button", { name: "Exit Operator Mode", exact: true })
    .click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)
})

test("guided intake opens the selected tenant's editable onboarding form", async ({ page }) => {
  await login(page, "browser-owner@example.test")
  await openOnboarding(page)
  await page.getByRole("button", { name: "Open intake", exact: true }).click()
  await expect(page).toHaveURL(/\/app\/onboarding/)
  await expect(page.getByRole("banner", { name: "Operator mode active" })).toContainText("Browser pending workspace")
  await expect(page.getByRole("heading", { name: "Get started", exact: true })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Legal business name", exact: true })).toBeEditable()
  await page.goto("/app/settings")
  for (const label of ["Public brokerage or team name", "Office email", "Office phone", "Business hours", "Service areas, one per line", "Scheduling instructions", "Approved FAQs, one “question | answer” per line", "Approved qualification questions, one per line", "Additional prohibited topics, one per line", "Escalation instructions", "Required disclaimer language"]) {
    await expect(page.getByRole("textbox", { name: label, exact: true })).toBeEditable()
  }
  await page.getByRole("button", { name: "Exit Operator Mode", exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/dashboard/)
})

test("consent review follows client navigation and testing workspaces remain discoverable", async ({ page, isMobile }) => {
  const { tenantId } = accounts()
  await page.route("**/api/backend/admin/tenants", async (route) => {
    const response = await route.fetch()
    const tenants = await response.json()
    await route.fulfill({ response, json: tenants.map((tenant: { id: string; lifecycleStatus: string }) =>
      tenant.id === tenantId ? { ...tenant, lifecycleStatus: "TESTING" } : tenant) })
  })
  let active = true
  await page.route(`**/api/backend/admin/tenants/${tenantId}/testing/diagnostics`, async (route) => {
    await route.fulfill({ json: active ? {
      testRunId: randomUUID(), status: "running", leadId: randomUUID(), aiRun: null,
      messages: [{ id: randomUUID(), channel: "email", status: "blocked", errorCode: "TENANT_AUTOMATION_PAUSED", blockedReason: "Synthetic pause diagnostic", safetyRuleIds: ["tenant_pause"], sanitizedErrorMessage: null }],
    } : { testRunId: null, status: null, leadId: null, aiRun: null, messages: [] } })
  })
  await login(page, "browser-owner@example.test")
  await page.goto("/admin/dashboard")
  if (isMobile) {
    const mobileNavigation = page.getByRole("button", { name: "Open admin navigation", exact: true })
    await expect(mobileNavigation).toBeVisible()
    await mobileNavigation.click()
  }
  await page.getByRole("link", { name: "Onboarding", exact: true }).click()
  const workspace = page.getByRole("button", { name: "Browser pending workspace Testing", exact: false })
  await expect(workspace).toBeVisible()
  await workspace.click()
  await page.getByRole("button", { name: "Open client", exact: true }).click()
  await page.getByRole("tab", { name: "Setup", exact: true }).click()
  await expect(page.getByRole("button", { name: "Review consent evidence", exact: true })).toBeVisible()
  const diagnostics = page.getByRole("region", { name: "Controlled test status", exact: true })
  await expect(diagnostics).toContainText("No AI run was queued")
  await expect(diagnostics).toContainText("TENANT_AUTOMATION_PAUSED")
  await expect(diagnostics.getByRole("button", { name: "Open test conversation" })).toBeEnabled()
  active = false
  await diagnostics.getByRole("button", { name: "Refresh test status", exact: true }).click()
  await expect(diagnostics).toContainText("No active controlled test run.")
  await expect(diagnostics).not.toContainText("TENANT_AUTOMATION_PAUSED")
  await page.getByRole("tab", { name: "Overview", exact: true }).click()
  await expect(page.getByRole("button", { name: "Review consent evidence", exact: true })).toHaveCount(0)
})

test("operator test view reveals real controlled conversations while normal views keep them hidden", async ({ page, browser }) => {
  const { conversationTenantId, conversationLeadId } = accounts()
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  const testRunId = randomUUID()
  const handoffId = randomUUID()
  await db.connect()
  try {
    await db.query("INSERT INTO test_runs (id, tenant_id, status, test_lead_id, expires_at) VALUES ($1, $2, 'passed', $3, now() + interval '1 hour')", [testRunId, conversationTenantId, conversationLeadId])
    await db.query('UPDATE leads SET test_run_id = $1 WHERE id = $2', [testRunId, conversationLeadId])
    await db.query("INSERT INTO lead_handoffs (id, tenant_id, lead_id, status, reason, summary, recommended_action) VALUES ($1, $2, $3, 'open', 'Synthetic operator handoff', 'Controlled conversation acceptance', 'Review the test conversation')", [handoffId, conversationTenantId, conversationLeadId])
    await login(page, "browser-owner@example.test")
    const entered = await page.request.post("/api/backend/admin/operator-mode", {
      headers: { origin: "http://127.0.0.1:3400" }, data: { tenantId: conversationTenantId },
    })
    expect(entered.status()).toBe(201)
    await page.goto("/app/inbox")
    const toggle = page.getByRole("checkbox", { name: "Include controlled test conversations", exact: true })
    await expect(toggle).toBeVisible()
    await expect(toggle).not.toBeChecked()
    await expect(page.getByTestId(`thread-${conversationLeadId}`)).toHaveCount(0)
    const included = await page.request.get("/api/backend/messaging/threads?scope=shared&take=50&skip=0&includeMeta=1&includeTest=true")
    expect(included.status(), await included.text()).toBe(200)
    expect((await included.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ leadId: conversationLeadId })]))
    await toggle.check()
    try {
      await expect(page.getByTestId(`thread-${conversationLeadId}`)).toBeVisible()
    } catch (error) {
      console.log("Controlled test view failure", await page.locator("body").innerText())
      throw error
    }
    await expect(page.locator("[data-message-id]").last()).toBeVisible()
    const ownershipBefore = await db.query('SELECT ownership_status FROM conversation_ai_states WHERE lead_id = $1', [conversationLeadId])
    expect(['human_handling', 'paused']).toContain(ownershipBefore.rows[0].ownership_status)
    const ordinaryContext = await browser.newContext()
    try {
      const signedIn = await ordinaryContext.request.post("/api/backend/auth/login", {
        headers: { origin: "http://127.0.0.1:3400" },
        data: { email: "browser-conversations@example.test", password: accounts().password },
      })
      expect(signedIn.status()).toBe(200)
      const denied = await ordinaryContext.request.patch(`/api/backend/client/handoffs/${handoffId}`, {
        headers: { origin: "http://127.0.0.1:3400" },
        data: { action: "completed", note: "Ordinary client must not complete the operator fixture" },
      })
      expect(denied.status()).toBe(404)
      const stillOpen = await db.query('SELECT status FROM lead_handoffs WHERE id = $1', [handoffId])
      expect(stillOpen.rows).toEqual([{ status: 'open' }])
    } finally { await ordinaryContext.close() }
    await page.getByRole("button", { name: "Complete human handoff", exact: true }).click()
    await expect(page.getByRole("button", { name: "Complete human handoff", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Resume AI", exact: true })).toBeVisible()
    const handoff = await db.query('SELECT status, completion_note FROM lead_handoffs WHERE id = $1', [handoffId])
    expect(handoff.rows).toEqual([{ status: 'completed', completion_note: 'Completed from Conversations' }])
    const state = await db.query('SELECT ownership_status FROM conversation_ai_states WHERE lead_id = $1', [conversationLeadId])
    expect(state.rows[0].ownership_status).toBe(ownershipBefore.rows[0].ownership_status)
    await page.getByRole("button", { name: "Resume AI", exact: true }).click()
    const confirmation = page.getByRole("alertdialog", { name: "Return this conversation to AI?", exact: true })
    await expect(confirmation).toBeVisible()
    await confirmation.getByRole("button", { name: "Keep human control", exact: true }).click()
    await expect(confirmation).toHaveCount(0)
    const afterCancel = await db.query('SELECT ownership_status FROM conversation_ai_states WHERE lead_id = $1', [conversationLeadId])
    expect(afterCancel.rows).toEqual(state.rows)
    await toggle.uncheck()
    await expect(page.getByTestId(`thread-${conversationLeadId}`)).toHaveCount(0)

    const clientContext = await browser.newContext()
    const clientPage = await clientContext.newPage()
    try {
      await login(clientPage, "browser-client@example.test")
      await clientPage.goto("/app/inbox?includeTest=true")
      await expect(clientPage.getByRole("heading", { name: "Conversations", exact: true })).toBeVisible()
      await expect(clientPage.getByRole("checkbox", { name: "Include controlled test conversations", exact: true })).toHaveCount(0)
    } finally { await clientContext.close() }
  } finally {
    await page.request.post("/api/backend/admin/operator-mode/exit", { headers: { origin: "http://127.0.0.1:3400" } }).catch(() => undefined)
    await db.query('DELETE FROM lead_handoffs WHERE id = $1', [handoffId])
    await db.query('UPDATE leads SET test_run_id = NULL WHERE id = $1', [conversationLeadId])
    await db.query('DELETE FROM test_runs WHERE id = $1', [testRunId])
    await db.end()
  }
})

test("staff sees an explained invitation restriction and cannot call owner APIs", async ({
  page,
}) => {
  await login(page, "browser-staff@example.test")
  await openOnboarding(page)
  await expect(
    page.getByRole("button", { name: "Resend invite", exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByRole("button", { name: "Next step: Resend invite", exact: true }),
  ).toBeDisabled()
  await expect(
    page
      .getByText("Platform owner access is required for this action.", {
        exact: true,
      })
      .first(),
  ).toBeVisible()
  const denied = await page.request.post(
    `/api/backend/admin/tenants/${accounts().tenantId}/invitation/resend`,
    { headers: { origin: "http://127.0.0.1:3400" } },
  )
  expect(denied.status()).toBe(403)
  expect((await page.request.get(`/api/backend/admin/operator-test/grants/${accounts().tenantId}`)).status()).toBe(403)
  await page.goto(`/admin/dashboard?view=clients&tenantId=${accounts().tenantId}&clientTab=overview`)
  await expect(page.getByRole("region", { name: "Operator email test", exact: true })).toHaveCount(0)
  await page.getByRole("tab", { name: "Setup", exact: true }).click()
  await expect(page.getByRole("button", { name: "Review consent evidence", exact: true })).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Controlled test status", exact: true })).toHaveCount(0)
})

test("client and anonymous sessions cannot access the admin workspace or tenant-user API", async ({
  page,
}) => {
  const path = `/api/backend/admin/tenants/${accounts().tenantId}/users`
  expect((await page.request.get(path)).status()).toBe(401)
  await login(page, "browser-client@example.test")
  expect((await page.request.get(path)).status()).toBe(403)
  await page.goto(
    `/admin/dashboard?view=onboarding&tenantId=${accounts().tenantId}`,
  )
  await expect(page).toHaveURL(/\/app\//)
  await expect(page.getByText("Guided setup", { exact: true })).toHaveCount(0)
})
