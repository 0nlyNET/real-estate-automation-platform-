import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

const chat = read("components/ai/restricted-assistant-chat.tsx")
const adminPage = read("app/admin/assistant/page.tsx")
const clientPage = read("app/app/assistant/page.tsx")
const dashboard = read("app/admin/dashboard/admin-dashboard-client.tsx")
const proxy = read("proxy.ts")
const api = read("lib/api.ts")

// Both user journeys must enter the same tested request/response component.
assert.match(adminPage, /endpoint="\/admin\/ai\/operations-assistant"/)
assert.match(adminPage, /statusEndpoint="\/admin\/ai\/provider-test"/)
assert.match(adminPage, /session\.platformRole === "super_admin"/)
assert.match(clientPage, /endpoint="\/ai\/client-assistant"/)
assert.match(clientPage, /statusEndpoint="\/ai\/client-assistant\/status"/)
assert.match(clientPage, /Conversation history is encrypted and bound to your user and workspace/)

// A browser timeout or retry must not duplicate provider work or tool actions.
assert.match(chat, /crypto\.randomUUID\(\)/)
assert.match(chat, /body: \{ prompt: nextPrompt, requestId \}/)
assert.match(chat, /failedRequest\.requestId/)
assert.match(chat, /same request ID prevents duplicate actions/)
assert.match(chat, /AbortSignal\.timeout\(50_000\)/)
assert.match(chat, /if \(!nextPrompt \|\| busy\) return/)
assert.match(chat, /pendingRequest/)
assert.match(chat, /requestOutcomeMayStillComplete/)
assert.match(chat, /uncertainRequestId/)
assert.match(chat, /window\.setInterval\(\(\) => void refreshHistory\(\),\s*2_500\)/)
assert.match(chat, /shouldStickToBottom/)
assert.match(chat, /scrollIntoView/)
assert.match(chat, /event\.key === "Enter"/)
assert.match(chat, /!event\.shiftKey/)
assert.match(chat, /!event\.nativeEvent\.isComposing/)
assert.match(chat, /Enter sends · Shift\+Enter adds a new line/)

// Refresh-safe history, provider readiness, verified output, and exact confirmation
// arguments must all be visible instead of collapsing into a generic red error.
assert.match(chat, /Promise\.allSettled\(\[/)
assert.match(chat, /`\$\{endpoint\}\/history`/)
assert.match(chat, /AI provider configuration required/)
assert.match(chat, /OPENAI_API_KEY/)
assert.match(chat, /Run controlled provider test/)
assert.match(chat, /Verified result details/)
assert.match(chat, /result\.status === "executed"/)
assert.match(chat, /Assistant request failed/)
assert.match(chat, /pretty\(item\.arguments\)/)

// Frontend API errors retain machine-readable backend failure codes.
assert.match(api, /export class ApiError extends Error/)
assert.match(api, /extractErrorCode\(payload\)/)

// Independent health failures must render independently, and transient session
// introspection failures get one bounded retry while authoritative denial fails closed.
assert.match(dashboard, /Promise\.allSettled\(\[/)
assert.match(dashboard, /`\$\{label\} did not respond within 15 seconds\.`/)
assert.match(dashboard, /healthCheck<SystemHealth>\("\/admin\/system-health", "System health"\)/)
assert.match(proxy, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/)
assert.match(proxy, /response\.status === 401 \|\| response\.status === 403/)
assert.match(proxy, /AbortSignal\.timeout\(5_000\)/)

console.log("Admin/client assistant workflow regression checks passed.")
