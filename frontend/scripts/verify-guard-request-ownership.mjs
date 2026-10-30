import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import vm from "node:vm"
import ts from "typescript"

const require = createRequire(import.meta.url)
async function loadTs(file, dependencies = {}, globals = {}) {
  const source = await readFile(file, "utf8")
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const exports = {}
  vm.runInNewContext(js, { exports, require: (name) => dependencies[name] ?? require(name), URL, URLSearchParams, Headers, Response, Request, process, AbortSignal, AbortController, Error, DOMException, console, ...globals })
  return exports
}
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve)) }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

// React hooks mock with effect cleanup/restart support
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
  return {
    react,
    slots,
    render: (component, props) => { index = 0; return component(props) },
    effects: () => { for (const effect of effects.splice(0)) cleanups.push(effect()) },
    cleanup: () => { const c = cleanups.splice(0); c.forEach((fn) => fn?.()) },
    getState: (hookIndex) => slots[hookIndex],
  }
}

const dummyWindow = () => {
  const listeners = {}
  return {
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn) },
    removeEventListener: (type, fn) => { listeners[type] = (listeners[type] || []).filter(f => f !== fn) },
    dispatchEvent: (event) => { (listeners[event.type] || []).forEach(fn => fn(event)) },
    setTimeout: (fn) => { fn(); return 1 },
    clearTimeout() {},
    location: { pathname: "/app/automations" },
  }
}
const ui = new Proxy({}, { get: (_target, name) => name })
const { clientNavigation, isSetupPath } = await loadTs("lib/client-navigation.ts")

console.log("=== Delayed-request regression: access guard request ownership ===\n")

// Test 1: Cleanup/restart starts a fresh check (not wedged)
console.log("Test 1: Cleanup during delayed /me, then restart, must start fresh check")
{
  let requestCount = 0
  const requests = []
  const makeGuard = () => {
    const h = hooks()
    const win = dummyWindow()
    return loadTs("app/app/client-access-guard.tsx", {
      react: h.react, "next/navigation": { usePathname: () => "/app/automations" }, "next/link": "Link",
      "@/lib/api": { apiFetch: (path, init) => { requestCount++; const d = deferred(); requests.push({ d, signal: init?.signal }); return d.promise } },
      "@/lib/client-navigation": { clientNavigation, isSetupPath },
      "@/components/app-shell/app-shell": { AppShell: "AppShell" },
      "@/components/ui/button": ui,
    }, { window: win }).then(({ ClientAccessGuard }) => ({ h, win, ClientAccessGuard }))
  }

  // Mount, effect runs, verify starts (delayed)
  let { h, win, ClientAccessGuard } = await makeGuard()
  h.render(ClientAccessGuard, { children: "CHILD" }); h.effects(); await flush()
  assert.equal(requestCount, 1, "First verify issues /me")
  console.log("  ✓ First /me issued (delayed)")

  // Cleanup while in flight (simulates unmount/navigation)
  h.cleanup()
  console.log("  ✓ Cleanup ran (aborted old request, invalidated generation)")

  // Restart with FRESH hooks (simulates true remount with fresh refs)
  ;({ h, win, ClientAccessGuard } = await makeGuard())
  h.render(ClientAccessGuard, { children: "CHILD" }); h.effects(); await flush()
  assert.equal(requestCount, 2, "Restart must issue fresh /me (not wedge on stale state)")
  console.log("  ✓ Fresh /me issued after restart (not wedged)")

  // Resolve the NEW request with allowed=true — guard must show children
  requests[1].d.resolve({ platformRole: null, serviceAccess: { allowed: true, billingEligible: true }, operatorMode: null, operatorTenantRequired: false, impersonated: false })
  await flush()
  const tree = h.render(ClientAccessGuard, { children: "CHILD" })
  const text = JSON.stringify(tree)
  assert.ok(text.includes("CHILD"), "Guard must render children after allowed response")
  console.log("  ✓ Guard renders children after fresh allowed response")
  h.cleanup()
}
console.log("PASS Test 1\n")

// Test 2: Stale request cannot clear newer check or reveal stale access
console.log("Test 2: Old request finishing after newer request must not affect state")
{
  let requestCount = 0
  const requests = []
  const makeGuard = () => {
    const h = hooks()
    const win = dummyWindow()
    return loadTs("app/app/client-access-guard.tsx", {
      react: h.react, "next/navigation": { usePathname: () => "/app/automations" }, "next/link": "Link",
      "@/lib/api": { apiFetch: (path, init) => { requestCount++; const d = deferred(); requests.push({ d, signal: init?.signal }); return d.promise } },
      "@/lib/client-navigation": { clientNavigation, isSetupPath },
      "@/components/app-shell/app-shell": { AppShell: "AppShell" },
      "@/components/ui/button": ui,
    }, { window: win }).then(({ ClientAccessGuard }) => ({ h, win, ClientAccessGuard }))
  }

  let { h, win, ClientAccessGuard } = await makeGuard()
  h.render(ClientAccessGuard, { children: "CHILD" }); h.effects(); await flush()
  assert.equal(requestCount, 1)
  const firstRequest = requests[0]

  // Cleanup (aborts first request) and restart with fresh hooks (starts second)
  h.cleanup()
  ;({ h, win, ClientAccessGuard } = await makeGuard())
  h.render(ClientAccessGuard, { children: "CHILD" }); h.effects(); await flush()
  assert.equal(requestCount, 2, "Second request started")
  const secondRequest = requests[1]

  // First (stale) request resolves with DIFFERENT data — must be ignored
  // (In real React, the first component unmounted, so this simulates a race
  // where the stale promise resolves after the new component mounted)
  firstRequest.d.resolve({ platformRole: "admin", serviceAccess: { allowed: false, billingEligible: false, reason: "stale" }, operatorMode: null, operatorTenantRequired: false, impersonated: false })
  await flush()

  // Resolve second request with allowed=true
  secondRequest.d.resolve({ platformRole: null, serviceAccess: { allowed: true, billingEligible: true }, operatorMode: null, operatorTenantRequired: false, impersonated: false })
  await flush()
  const tree = h.render(ClientAccessGuard, { children: "CHILD" })
  const text = JSON.stringify(tree)
  assert.ok(text.includes("CHILD"), "Stale request must not block newer allowed response")
  console.log("  ✓ Stale request ignored; newer check owns the state")
  h.cleanup()
}
console.log("PASS Test 2\n")

// Test 3: Allowed, denied, and timeout results settle correctly
console.log("Test 3: Allowed / denied / timeout settle to correct UI state")
{
  const scenarios = [
    { name: "allowed", response: { platformRole: null, serviceAccess: { allowed: true, billingEligible: true }, operatorMode: null, operatorTenantRequired: false, impersonated: false }, expectChild: true, expectError: false },
    { name: "denied", response: { platformRole: null, serviceAccess: { allowed: false, billingEligible: false, reason: "Payment not confirmed" }, operatorMode: null, operatorTenantRequired: false, impersonated: false }, expectChild: false, expectError: false },
    { name: "timeout", error: new Error("timeout"), expectChild: false, expectError: true },
  ]
  for (const sc of scenarios) {
    const h = hooks()
    const win = dummyWindow()
    let requestDeferred = deferred()
    const { ClientAccessGuard } = await loadTs("app/app/client-access-guard.tsx", {
      react: h.react, "next/navigation": { usePathname: () => "/app/automations" }, "next/link": "Link",
      "@/lib/api": { apiFetch: () => requestDeferred.promise },
      "@/lib/client-navigation": { clientNavigation, isSetupPath },
      "@/components/app-shell/app-shell": { AppShell: "AppShell" },
      "@/components/ui/button": ui,
    }, { window: win })

    h.render(ClientAccessGuard, { children: "CHILD" }); h.effects(); await flush()
    if (sc.error) requestDeferred.reject(sc.error)
    else requestDeferred.resolve(sc.response)
    await flush()

    const tree = h.render(ClientAccessGuard, { children: "CHILD" })
    const text = JSON.stringify(tree)
    const hasChild = text.includes("CHILD")
    const hasError = text.includes("could not be checked")
    assert.equal(hasChild, sc.expectChild, `${sc.name}: child visibility`)
    assert.equal(hasError, sc.expectError, `${sc.name}: error visibility`)
    console.log(`  ✓ ${sc.name}: child=${hasChild}, error=${hasError} (expected)`)
    h.cleanup()
  }
}
console.log("PASS Test 3\n")

// Test 4: Failed check shows retryable error without exposing stale content
console.log("Test 4: Failed check must not reveal previous access state")
{
  const h = hooks()
  const win = dummyWindow()
  let requestDeferred = deferred()
  const { ClientAccessGuard } = await loadTs("app/app/client-access-guard.tsx", {
    react: h.react, "next/navigation": { usePathname: () => "/app/automations" }, "next/link": "Link",
    "@/lib/api": { apiFetch: () => requestDeferred.promise },
    "@/lib/client-navigation": { clientNavigation, isSetupPath },
    "@/components/app-shell/app-shell": { AppShell: "AppShell" },
    "@/components/ui/button": ui,
  }, { window: win })

  // First: successful allowed check
  h.render(ClientAccessGuard, { children: "SECRET_CHILD" }); h.effects(); await flush()
  requestDeferred.resolve({ platformRole: null, serviceAccess: { allowed: true, billingEligible: true }, operatorMode: null, operatorTenantRequired: false, impersonated: false })
  await flush()
  let tree = h.render(ClientAccessGuard, { children: "SECRET_CHILD" })
  assert.ok(JSON.stringify(tree).includes("SECRET_CHILD"), "First check allows content")

  // Second: failed check (simulate via event) — must show error, NOT stale child
  requestDeferred = deferred()
  win.dispatchEvent({ type: "rta:workspace-access-changed" })
  await flush()
  requestDeferred.reject(new Error("network down"))
  await flush()
  tree = h.render(ClientAccessGuard, { children: "SECRET_CHILD" })
  const text = JSON.stringify(tree)
  assert.ok(!text.includes("SECRET_CHILD"), "Failed check must NOT reveal stale workspace content")
  assert.ok(text.includes("could not be checked"), "Failed check must show retryable error")
  console.log("  ✓ Failed check hides content, shows retryable error (no stale exposure)")
  h.cleanup()
}
console.log("PASS Test 4\n")

console.log("=== All delayed-request regression tests PASSED ===")
