import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const fromPackage = createRequire(path.join(packageRoot, "package.json"));
const pluginRoot = path.dirname(fromPackage.resolve("@next/eslint-plugin-next/package.json"));
const helperPath = path.join(pluginRoot, "dist/utils/get-root-dirs.js");
const helperSource = fs.readFileSync(helperPath, "utf8");
assert.match(helperSource, /require\("fast-glob"\)/);
assert.match(helperSource, /onlyDirectories: true/);
const fromHelper = createRequire(helperPath);
const adapter = fromHelper("fast-glob");
assert.equal(fromHelper("fast-glob/package.json").name, "rta-next-root-glob");
const { getRootDirs } = fromHelper(helperPath);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "rta-next-roots-"));
const previous = process.cwd();
try {
  for (const directory of ["apps/alpha/nested", "apps/beta", "apps/.hidden"])
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.writeFileSync(path.join(root, "apps/plain-file"), "not a directory");
  process.chdir(root);
  const roots = (rootDir) => getRootDirs({ cwd: root, settings: { next: { rootDir } } }).sort();
  assert.deepEqual(getRootDirs({ cwd: root, settings: {} }), [root]);
  assert.deepEqual(roots("apps/alpha"), ["apps/alpha"]);
  assert.deepEqual(roots("apps/*"), ["apps/alpha", "apps/beta"]);
  assert.deepEqual(roots("apps/{alpha,beta}"), ["apps/alpha", "apps/beta"]);
  assert.deepEqual(roots("apps/**"), ["apps", "apps/alpha", "apps/alpha/nested", "apps/beta"]);
  assert.deepEqual(roots(path.join(root, "apps/*")), [path.join(root, "apps/alpha"), path.join(root, "apps/beta")]);
  assert.deepEqual(roots(["apps/alpha", "apps/beta", 42]), ["apps/alpha", "apps/beta"]);
  assert.deepEqual(roots("apps/plain-file"), []);
  assert.deepEqual(roots("missing/*"), []);
  assert.throws(() => adapter.globSync("apps/*", { onlyFiles: true }), TypeError);
  assert.throws(() => adapter.globSync("apps/*", { onlyDirectories: true, unknown: true }), TypeError);
  console.log(`Next ESLint root-directory compatibility passed: ${path.basename(packageRoot)}`);
} finally {
  process.chdir(previous);
  fs.rmSync(root, { recursive: true, force: true });
}
