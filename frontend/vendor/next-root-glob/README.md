# Next ESLint root-directory glob adapter

Scoped npm override for `@next/eslint-plugin-next` only. Its `getRootDirs` helper calls `fast-glob.globSync(pattern, { onlyDirectories: true })`. The upstream dependency pulls in the vulnerable `braces` package (GHSA-vfj7-8cjw-p6xm), with no fixed release available at implementation time.

This adapter delegates that one directory-only operation to pinned registry package `tinyglobby@0.2.17`, disables recursive expansion of literal directory patterns, preserves absolute patterns, and removes its trailing directory slash to preserve the Next helper's result. Unsupported calls fail explicitly. All Next ESLint rules and the existing npm audit gate remain enabled. This is original adapter code, not a purported patched upstream release.

`frontend/scripts/verify-next-root-glob.mjs` checks the actual installed Next helper against nested, literal, wildcard, brace and absolute directory patterns, settings arrays, file exclusion and malformed options. Recheck this contract before updating the Next plugin.
