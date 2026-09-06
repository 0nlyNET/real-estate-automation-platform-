import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import vm from "node:vm"
import ts from "typescript"

async function loadTs(file, dependencies = {}, globals = {}) {
  const source = await readFile(file, "utf8")
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(js, { exports, require: (name) => dependencies[name], URL, process, AbortSignal, ...globals })
  return exports
}
const { supportReturnPath } = await loadTs("lib/support-navigation.ts")
assert.equal(supportReturnPath("/app/inbox?leadId=one", false, true), "/app/inbox?leadId=one")
assert.equal(supportReturnPath("/admin/dashboard?view=support", true, true), "/admin/dashboard?view=support")
for (const input of ["//evil.example/path", "https://evil.example", "/app/../../admin/dashboard", "/app/%2f%2fevil.example", "/admin/dashboard"]) {
  assert.equal(supportReturnPath(input, false, true), "/app/dashboard")
}
assert.equal(supportReturnPath(null, false, false), "/")

const session = { userId: "client", platformRole: null, serviceAccess: { allowed: false, billingEligible: false } }
const { proxy } = await loadTs("proxy.ts", {
  "next/server": { NextResponse: { redirect: (url) => ({ redirect: String(url) }), next: () => ({ allowed: true }) } },
}, { fetch: async () => ({ ok: true, json: async () => session }) })
const request = (path) => ({ url: `https://app.example${path}`, nextUrl: new URL(`https://app.example${path}`), headers: new Headers({ cookie: "session=fixture" }) })
assert.equal((await proxy(request("/app/inbox"))).redirect, "https://app.example/app/billing")
assert.equal((await proxy(request("/app/onboarding"))).allowed, true)
assert.equal((await proxy(request("/app/billing"))).allowed, true)
assert.equal((await proxy(request("/admin/dashboard"))).redirect, "https://app.example/app/dashboard")
session.serviceAccess = { allowed: true, billingEligible: true }
assert.equal((await proxy(request("/app/inbox"))).allowed, true)
session.serviceAccess = { allowed: false, billingEligible: true }
assert.equal((await proxy(request("/app/inbox"))).redirect, "https://app.example/support")
console.log("First-client payment routes and safe support navigation passed")
