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
const supportHistorySource = await readFile("components/support-navigation-history.tsx", "utf8")
assert.match(supportHistorySource, /useSearchParams/)
assert.match(supportHistorySource, /\[pathname,\s*search\]/)
assert.match(supportHistorySource, /supportReturnPath", `\$\{pathname\}\$\{query\}`/)

// Payment restriction behavior is exercised by verify-session-navigation.mjs.
// Backend workspace-access.e2e.spec.ts independently proves that unpaid API
// reads/writes remain denied even though page navigation is allowed.
console.log("First-client safe support navigation passed")
