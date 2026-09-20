import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const requireBackend = createRequire(join(process.cwd(), '../backend/package.json'))
const { Client } = requireBackend('pg')
const accounts = () => JSON.parse(readFileSync(join(process.cwd(), '.e2e/accounts.json'), 'utf8'))
const origin = { origin: 'http://127.0.0.1:3400' }
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['cookies']>>>()

async function login(page: Page, email = 'browser-conversations@example.test') {
  // These tests exercise Conversations. Reuse each worker's real login cookies
  // to stay within the production login limit shared by the browser suite.
  const cookies = sessions.get(email)
  if (cookies) {
    await page.context().addCookies(cookies)
    return
  }
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(accounts().password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/app\//)
  sessions.set(email, await page.context().cookies())
}

async function state(page: Page) {
  const response = await page.request.get('/api/backend/messaging/threads?includeMeta=1')
  expect(response.status()).toBe(200)
  return (await response.json()).items.find((row: { leadId: string }) => row.leadId === accounts().conversationLeadId)
}

test('Conversations preserves a message arriving between rendering and read acknowledgement', async ({ page, browser }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await login(page)
  const leadId = accounts().conversationLeadId
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  await db.connect()
  let inserted = false
  let newMessageId = ''
  try {
    await db.query('DELETE FROM conversation_read_states WHERE tenant_id = $1', [accounts().conversationTenantId])
    await page.route(`**/messaging/threads/${leadId}/read`, async (route) => {
      if (!inserted) {
        inserted = true
        const rows = await db.query(`INSERT INTO messages ("leadId",channel,direction,body,status)
          VALUES ($1,'email','inbound','Arrived after the displayed snapshot','received') RETURNING id`, [leadId])
        newMessageId = rows.rows[0].id
      }
      await route.continue()
    })
    // Hold incremental polling so the new message stays outside the rendered snapshot.
    await page.route(`**/messaging/threads/${leadId}?*`, async (route) => {
      if (route.request().url().includes('changedAfter=')) {
        await route.fulfill({ json: { items: [], hasOlder: false, hasMoreChanges: false, nextChanges: '', readState: null } })
      } else await route.continue()
    })
    await page.goto('/app/inbox')
    const thread = page.getByTestId(`thread-${leadId}`)
    await expect(thread).toContainText('conversation-lead@example.test')
    await expect(thread).toContainText('+15555550199')
    await expect(thread).toContainText('Website form')
    await expect(thread).toContainText('AI Paused')
    await expect(thread.locator('time')).toHaveCount(1)
    await page.locator('[data-message-id]').last().scrollIntoViewIfNeeded()
    await expect.poll(async () => (await state(page)).unreadCount).toBe(1)
    expect(inserted).toBe(true)
    expect((await state(page)).lastReadMessageId).not.toBe(newMessageId)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('conversations.png'), fullPage: true })

    // Simulate a successful send response without contacting a provider. The
    // reply is newer than the unseen inbound and is appended directly by the UI.
    const outbound = (await db.query(`INSERT INTO messages ("leadId",channel,direction,body,status)
      VALUES ($1,'email','outbound','Synthetic manual reply after the unseen inbound','sent')
      RETURNING id,channel,direction,body,status,created_at AS "createdAt"`, [leadId])).rows[0]
    await page.route('**/messaging/send', async (route) => {
      await route.fulfill({ json: { status: outbound.status, message: outbound } })
    })
    await page.getByPlaceholder('Write an email reply…').fill(outbound.body)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.locator(`[data-message-id="${outbound.id}"]`)).toBeVisible()
    await page.waitForTimeout(500)
    expect((await state(page)).unreadCount).toBe(1)
    expect((await state(page)).lastReadMessageId).not.toBe(outbound.id)

    await page.getByRole('button', { name: 'Mark unread', exact: true }).click()
    await expect.poll(async () => (await state(page)).markedUnread).toBe(true)
    await page.goto('/app/leads')
    expect((await state(page)).markedUnread).toBe(true)

    const peerContext = await browser.newContext()
    const peerPage = await peerContext.newPage()
    await login(peerPage, 'browser-peer@example.test')
    expect((await state(peerPage)).unreadCount).toBeGreaterThan(1)
    await peerContext.close()

    await page.unrouteAll({ behavior: 'wait' })
    await page.goto('/app/inbox')
    await page.locator('[data-message-id]').last().scrollIntoViewIfNeeded()
    await expect.poll(async () => (await state(page)).isUnread).toBe(false)
    await page.reload()
    await expect.poll(async () => (await state(page)).isUnread).toBe(false)
    await expect(page.getByRole('button', { name: 'Load earlier messages' })).toBeVisible()
    await page.getByRole('button', { name: 'Load earlier messages' }).click()
    await expect(page.locator('[data-message-id]').first()).toContainText('Synthetic conversation message 1')
    expect(errors).toEqual([])
  } finally { await db.end() }
})

test('Conversations API rejects foreign leads, forged watermark ownership, and missing watermarks', async ({ page }) => {
  await login(page)
  const { conversationLeadId, foreignLeadId } = accounts()
  expect((await page.request.get(`/api/backend/messaging/threads/${foreignLeadId}?includeMeta=1`)).status()).toBe(403)
  expect((await page.request.post(`/api/backend/messaging/threads/${foreignLeadId}/unread`, { headers: origin })).status()).toBe(403)
  expect((await page.request.post(`/api/backend/messaging/threads/${conversationLeadId}/read`, {
    headers: origin, data: { messageId: foreignLeadId, unreadVersion: 0 },
  })).status()).toBe(400)
  expect((await page.request.post(`/api/backend/messaging/threads/${conversationLeadId}/read`, {
    headers: origin, data: {},
  })).status()).toBe(400)
})

test('a stale read response cannot clear a newer mark-unread from another tab', async ({ page }) => {
  await login(page)
  const leadId = accounts().conversationLeadId
  let readRequests = 0
  await page.route(`**/messaging/threads/${leadId}/read`, async (route) => {
    readRequests += 1
    if (readRequests === 1) {
      const unread = await page.request.post(`/api/backend/messaging/threads/${leadId}/unread`, { headers: origin })
      expect(unread.status()).toBe(201)
    }
    await route.continue()
  })
  const firstRead = page.waitForResponse((response) => response.url().endsWith(`/threads/${leadId}/read`))
  await page.goto('/app/inbox')
  await page.locator('[data-message-id]').last().scrollIntoViewIfNeeded()
  await firstRead
  await expect(page.getByRole('button', { name: 'Mark read', exact: true })).toBeVisible()
  // Allow observer notifications and their 200ms debounce to settle. A broken
  // client retries with the returned version and silently clears the marker.
  await page.waitForTimeout(1500)
  expect((await state(page)).markedUnread).toBe(true)
  expect(readRequests).toBe(1)
  await page.getByRole('button', { name: 'Mark read', exact: true }).click()
  await expect.poll(async () => (await state(page)).markedUnread).toBe(false)
})
