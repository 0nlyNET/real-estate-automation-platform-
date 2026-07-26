import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const dashboard = read("app/admin/dashboard/page.tsx")
const adminIndex = read("app/admin/page.tsx")
const legacyOverview = read("app/admin/overview/page.tsx")
const layout = read("app/admin/layout.tsx")

assert.match(adminIndex, /redirect\("\/admin\/dashboard"\)/, "/admin must redirect to the canonical dashboard")
assert.match(legacyOverview, /redirect\("\/admin\/dashboard"\)/, "/admin/overview must redirect to the canonical dashboard")
assert.doesNotMatch(dashboard, /fullOperations|full=1|router\.replace\("\/admin\/overview"/, "the canonical dashboard must not redirect to its retired duplicate")
assert.match(dashboard, /router\.push\(`\/admin\/dashboard\?\$\{query\.toString\(\)\}`/, "tab changes must use Next navigation so browser history works")
assert.match(dashboard, /searchParams\.get\("view"\)/, "the selected tab must be restored from the URL")
assert.match(dashboard, /switchView\("onboarding", tenant\.id\)/, "client deep links must preserve their tenant selection")
assert.doesNotMatch(layout, /\/admin\/overview|full=1/, "admin navigation must only link to the canonical workspace")
assert.match(layout, /href="\/admin\/dashboard"/, "admin navigation must expose the canonical workspace")

console.log("Admin routing regression checks passed.")
