"use strict";
// Only @next/eslint-plugin-next's getRootDirs uses this scoped adapter.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Next loads this synchronous adapter through CommonJS.
const { globSync } = require("tinyglobby");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Next loads this synchronous adapter through CommonJS.
const { isAbsolute } = require("node:path");
exports.globSync = (pattern, options) => {
  if (typeof pattern !== "string" || options?.onlyDirectories !== true ||
      Object.keys(options).some((key) => !["onlyDirectories", "cwd"].includes(key))) {
    throw new TypeError("Next root-directory adapter only supports directory globs");
  }
  return globSync(pattern, { ...options, expandDirectories: false, absolute: isAbsolute(pattern) })
    .map((directory) => directory.length > 1 ? directory.replace(/\/$/, "") : directory);
};
