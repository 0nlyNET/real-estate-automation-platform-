import { test, expect, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function accounts(): { password: string; tenantId: string } {
  return JSON.parse(
    readFileSync(join(process.cwd(), ".e2e/accounts.json"), "utf8"),
  )
}

async function login(page: Page, email: string) {
  await page.goto("/login")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(accounts().password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expect(page).toHaveURL(
    email.includes("client") ? /\/app\// : /\/admin\/dashboard/,
  )
}

async function openOnboarding(page: Page) {
  await page.goto(
    `/admin/dashboard?view=onboarding&tenantId=${accounts().tenantId}`,
  )
  await expect(page.getByText("Guided setup", { exact: true })).toBeVisible()
}

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
  await expect(
    page.getByText("Not launch ready", { exact: true }),
  ).toBeVisible()
  await expect(page.getByText("100% onboarded", { exact: true })).toHaveCount(0)
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
  await expect(page).toHaveURL(/view=clients/)
  await expect(
    page.getByText("Browser pending workspace", { exact: true }).first(),
  ).toBeVisible()
  expect(errors).toEqual([])
  expect(failedRequests).toEqual([])
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
