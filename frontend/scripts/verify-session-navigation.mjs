import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import vm from "node:vm"
import ts from "typescript"

const require = createRequire(import.meta.url)
const { NextRequest } = require("next/server")
async function loadTs(file, dependencies = {}, globals = {}) {
  const source = await readFile(file, "utf8")
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  vm.runInNewContext(js, { exports, require: (name) => dependencies[name] ?? require(name), URL, URLSearchParams, Headers, Response, Request, process, AbortSignal, Error, DOMException, console, ...globals })
  return exports
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)) }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const { clientNavigation, isSetupPath } = await loadTs("lib/client-navigation.ts")
assert.deepEqual(Array.from(clientNavigation, (item) => item.href), ["/app/dashboard", "/app/leads", "/app/inbox", "/app/appointments", "/app/integrations", "/app/assistant"])
const session = { userId: "client", platformRole: null }
let status = 200, upstreamError = false, calls = 0
const { proxy } = await loadTs("proxy.ts", {}, { fetch: async (url) => {
  calls++
  assert.ok(url.endsWith("/auth/session"))
  if (upstreamError) throw new Error("Backend unavailable")
  return Response.json(session, { status })
} })
const req = (path, cookie = "rtai_session=opaque-test-cookie") => new NextRequest(`https://app.example${path}`, { headers: cookie ? { cookie } : {} })
for (const item of clientNavigation) {
  const response = await proxy(req(item.href))
  assert.equal(response.headers.get("x-middleware-next"), "1", `${item.label} must stay at its intended URL`)
  assert.equal(response.headers.get("location"), null)
}
assert.equal(new URL((await proxy(req("/admin/dashboard"))).headers.get("location")).pathname, "/app/dashboard")
session.platformRole = "super_admin"
assert.equal((await proxy(req("/admin/dashboard"))).headers.get("x-middleware-next"), "1")
for (const code of [403, 429, 500, 502, 503]) {
  status = code
  const result = await proxy(req("/admin/dashboard"))
  assert.equal(result.status, 503)
  assert.equal(result.headers.get("location"), null, `HTTP ${code} must not sign out`)
  assert.equal(result.headers.get("set-cookie"), null)
  assert.ok(result.headers.get("x-middleware-rewrite").endsWith("/session-unavailable"))
}
upstreamError = true
assert.equal((await proxy(req("/app/integrations"))).status, 503)
upstreamError = false; status = 401
assert.ok((await proxy(req("/admin/dashboard"))).headers.get("location").includes("/login?reason=session_expired"))
const beforeMissing = calls
await proxy(req("/app/dashboard", ""))
assert.equal(calls, beforeMissing, "Missing session must not query the backend")
status = 200; delete session.userId
assert.equal((await proxy(req("/admin/dashboard"))).status, 503, "Malformed responses fail closed without logging out")

// API route executes against real NextRequest/NextResponse, including JSON
// mutation serialization, cookies, no-store errors and bounded failure paths.
let upstream, captured
const route = await loadTs("app/api/backend/[...path]/route.ts", {}, {
  fetch: async (_url, options) => { captured = options; if (upstream instanceof Error) throw upstream; return upstream },
})
const context = { params: Promise.resolve({ path: ["notifications", "read-all"] }) }
upstream = Response.json({ ok: true }, { headers: { "set-cookie": "rtai_session=opaque; HttpOnly; Path=/; SameSite=Lax" } })
let result = await route.POST(new NextRequest("https://app.example/api/backend/notifications/read-all", { method: "POST", headers: { cookie: "rtai_session=opaque", origin: "https://app.example" } }), context)
assert.equal(result.status, 200)
assert.equal(captured.headers.get("origin"), "https://app.example")
assert.equal(captured.headers.get("cookie"), "rtai_session=opaque")
assert.ok(captured.signal instanceof AbortSignal)
assert.match(result.headers.get("set-cookie"), /HttpOnly/)
assert.match(result.headers.get("cache-control"), /no-store/)
upstream = new Error("Network disconnected")
result = await route.GET(req("/api/backend/me"), context)
assert.equal(result.status, 502)
assert.equal((await result.json()).code, "UPSTREAM_UNAVAILABLE")
assert.equal(result.headers.get("set-cookie"), null)

// A backend that sends headers then stalls must still hit the deadline.
let deadlineSignal
const deadlineRoute = await loadTs("app/api/backend/[...path]/route.ts", {}, {
  AbortSignal: { any: AbortSignal.any.bind(AbortSignal), timeout: (ms) => {
    assert.equal(ms, 12_000)
    const controller = new AbortController()
    setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), 10)
    return controller.signal
  } },
  fetch: async (_url, options) => {
    deadlineSignal = options.signal
    return { arrayBuffer: () => new Promise((_resolve, reject) => deadlineSignal.addEventListener("abort", () => reject(deadlineSignal.reason))) }
  },
})
result = await deadlineRoute.GET(req("/api/backend/me"), context)
assert.equal(result.status, 504)
assert.equal((await result.json()).code, "UPSTREAM_TIMEOUT")
assert.equal(result.headers.get("set-cookie"), null)

// Execute actual component handlers using a small deterministic hook scheduler.
// Browser verification separately covers DOM behavior and Next navigation.
function hooks() {
  const slots = [], effects = [], cleanups = []
  let index = 0
  const memo = (factory, deps) => {
    const i = index++, old = slots[i]
    if (!old || deps.some((value, n) => value !== old.deps[n])) slots[i] = { deps, value: factory() }
    return slots[i].value
  }
  const react = {
    useState: (initial) => { const i = index++; if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial; return [slots[i], (next) => { slots[i] = typeof next === "function" ? next(slots[i]) : next }] },
    useRef: (value) => { const i = index++; return slots[i] ||= { current: value } },
    useCallback: (fn, deps) => memo(() => fn, deps),
    useEffect: (fn, deps) => memo(() => { effects.push(fn); return null }, deps),
  }
  return { react, render: (component, props) => { index = 0; return component(props) }, effects: () => { for (const effect of effects.splice(0)) cleanups.push(effect()) }, cleanup: () => cleanups.forEach((fn) => fn?.()) }
}
const elements = (tree) => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(elements) : [tree, ...elements(tree.props?.children)]
const textContent = (tree) => tree == null || typeof tree === "boolean" ? "" : typeof tree !== "object" ? String(tree) : Array.isArray(tree) ? tree.map(textContent).join(" ") : textContent(tree.props?.children)
const dummyWindow = () => ({
  addEventListener() {}, removeEventListener() {}, setTimeout: (fn) => { fn(); return 1 }, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
  matchMedia: () => ({ matches: false }), location: { pathname: "/app/integrations" },
})
const ui = new Proxy({}, { get: (_target, name) => name })
let accessRequest = deferred(), pathname = "/app/integrations"
const h = hooks()
const { ClientAccessGuard } = await loadTs("app/app/client-access-guard.tsx", {
  react: h.react, "next/navigation": { usePathname: () => pathname }, "next/link": "Link",
  "@/lib/api": { apiFetch: () => accessRequest.promise }, "@/lib/client-navigation": { clientNavigation, isSetupPath },
  "@/components/app-shell/app-shell": { AppShell: "AppShell" }, "@/components/ui/button": ui,
}, { window: dummyWindow() })
const child = "PRIVATE_OPERATIONAL_CONTENT"
let tree = h.render(ClientAccessGuard, { children: child }); h.effects()
assert.match(textContent(tree), /Checking workspace access/)
assert.ok(!textContent(tree).includes(child), "Do not mount operational pages while access is initializing")
accessRequest.resolve({ platformRole: null, serviceAccess: { allowed: false, billingEligible: false, reason: "Payment not confirmed" } }); await flush()
tree = h.render(ClientAccessGuard, { children: child })
assert.match(textContent(tree), /Integrations/)
assert.match(textContent(tree), /Payment confirmation required/)
assert.ok(!textContent(tree).includes(child))
pathname = "/app/leads"; tree = h.render(ClientAccessGuard, { children: child })
assert.match(textContent(tree), /Leads/, "Restricted navigation should change the selected page")
pathname = "/app/billing"; assert.equal(h.render(ClientAccessGuard, { children: child }), child)
pathname = "/app/integrations"; accessRequest = deferred()
tree = h.render(ClientAccessGuard, { children: child })
const checkAgain = elements(tree).find((item) => textContent(item) === "Check access again")
checkAgain.props.onClick(); accessRequest.resolve({ platformRole: null, serviceAccess: { allowed: true, billingEligible: true } }); await flush()
assert.equal(h.render(ClientAccessGuard, { children: child }), child)
h.cleanup()

// A feature-level 401 never logs out a valid cookie; authoritative session
// expiry is confirmed once even if many requests fail concurrently.
let onExpired, expiryRequests = 0, expiryStatus = 200
const redirects = []
const expiryWindow = { location: { pathname: "/admin/dashboard", assign: (url) => redirects.push(url) },
  addEventListener: (_name, handler) => { onExpired = handler }, removeEventListener() {} }
const { SessionExpiryRedirect } = await loadTs("components/session-expiry-redirect.tsx", {
  react: { useEffect: (effect) => effect() },
}, { window: expiryWindow, fetch: async () => { expiryRequests++; return { status: expiryStatus } } })
SessionExpiryRedirect()
await Promise.all([onExpired(), onExpired()])
assert.equal(expiryRequests, 1)
assert.deepEqual(redirects, [])
expiryStatus = 503; await onExpired(); assert.deepEqual(redirects, [])
expiryStatus = 401; await onExpired(); assert.deepEqual(redirects, ["/login?reason=session_expired"])

// Notification controls update state only after success, support read filters,
// and expose mutation errors instead of producing unhandled rejections.
const n = hooks(), notes = [{ id: "one", title: "First notification", message: "Test", severity: "info", category: "leads", readAt: null, createdAt: new Date().toISOString() }, { id: "two", title: "Second notification", message: "Test", severity: "info", category: "leads", readAt: null, createdAt: new Date().toISOString() }]
let mutationFailure = false
const mutations = []
const fetchNotes = async (path, init = {}) => {
  if (init.method) {
    mutations.push({ path, method: init.method })
    if (mutationFailure) throw new Error("Please retry notification update")
    for (const row of notes) if (path.endsWith("/read-all") || path.endsWith(`/${row.id}/read`)) row.readAt = new Date().toISOString()
    return { ok: true }
  }
  if (path.includes("/summary")) return { unread: notes.filter((row) => !row.readAt).length, activeDevices: 0, pushConfigured: false }
  if (path.includes("/preferences/me")) return null
  return structuredClone(notes).filter((row) => !path.includes("read=unread") || !row.readAt)
}
const notificationDependencies = { react: n.react, "next/navigation": { useRouter: () => ({ push() {} }) }, "@/lib/api": { apiFetch: fetchNotes } }
for (const file of ["button", "input", "popover", "scroll-area", "switch"]) notificationDependencies[`@/components/ui/${file}`] = ui
const { NotificationCenter } = await loadTs("components/admin/notification-center.tsx", notificationDependencies, { window: dummyWindow(), navigator: { userAgent: "test" } })
tree = n.render(NotificationCenter, { audience: "client" }); n.effects(); await flush()
tree = n.render(NotificationCenter, { audience: "client" })
elements(tree).find((item) => item.props?.["aria-label"] === "Mark First notification as read").props.onClick(); await flush()
tree = n.render(NotificationCenter, { audience: "client" })
assert.equal(mutations[0].path, "/notifications/one/read")
assert.ok(!elements(tree).some((item) => item.props?.["aria-label"] === "Mark First notification as read"))
mutationFailure = true
elements(tree).find((item) => textContent(item).trim() === "Mark all as read").props.onClick(); await flush()
tree = n.render(NotificationCenter, { audience: "client" })
assert.match(textContent(tree), /Please retry notification update/)
assert.ok(!notes[1].readAt)
mutationFailure = false
elements(tree).find((item) => textContent(item).trim() === "Mark all as read").props.onClick(); await flush()
assert.ok(notes.every((row) => row.readAt))
assert.equal(mutations.at(-1).path, "/notifications/read-all")
n.cleanup()
console.log("Session/navigation regression passed: six routes, initialization/payment recovery, admin RBAC, authoritative expiry, transient failures, API deadlines/cookies, notification single/all/error flows.")
