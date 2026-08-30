import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"

const sourceRoots = ["app", "components", "hooks", "lib"]
const sourceFiles = []

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) await collect(target)
    else if (/\.(?:js|jsx|ts|tsx|mjs)$/.test(entry.name)) sourceFiles.push(target)
  }
}

for (const root of sourceRoots) await collect(root)

const dangerousHtml = []
for (const file of sourceFiles) {
  const source = await readFile(file, "utf8")
  if (/\bdangerouslySetInnerHTML\b|\.innerHTML\s*=|\bdocument\.write\s*\(|\beval\s*\(/.test(source)) {
    dangerousHtml.push(file)
  }
}
assert.deepEqual(
  dangerousHtml,
  [path.join("components", "ui", "chart.tsx")],
  "A new raw-HTML execution sink was introduced outside the reviewed chart CSS component",
)

const payloads = [
  '<script>globalThis.compromised=true</script>',
  '<img src=x onerror="globalThis.compromised=true">',
  '<svg onload="globalThis.compromised=true"></svg>',
]
for (const payload of payloads) {
  const rendered = renderToStaticMarkup(React.createElement("div", null, payload))
  assert.ok(rendered.includes("&lt;"), "React did not escape untrusted display text")
  assert.ok(!rendered.includes("<script"), "A script element survived React escaping")
  assert.ok(!rendered.includes("<img"), "An image event payload survived React escaping")
  assert.ok(!rendered.includes("<svg"), "An SVG event payload survived React escaping")
}

const proxySource = await readFile(path.join("app", "api", "backend", "[...path]", "route.ts"), "utf8")
assert.match(proxySource, /"origin"/, "The same-origin API proxy must forward Origin for backend CSRF enforcement")
assert.match(proxySource, /redirect:\s*"manual"/, "The API proxy must not automatically follow backend redirects")
assert.match(
  proxySource,
  /responseHeaders\.set\("cache-control", "private, no-store, max-age=0"\)/,
  "The API proxy must prevent browser and shared-cache storage of tenant responses",
)
assert.match(proxySource, /responseHeaders\.set\("pragma", "no-cache"\)/)
assert.match(proxySource, /responseHeaders\.set\("expires", "0"\)/)

console.log(
  `Frontend security verification passed: ${sourceFiles.length} source files checked, React escaped 3 XSS payloads, and proxy controls are present.`,
)
