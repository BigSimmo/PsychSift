#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { childProcessExitCode } from "./child-process-result.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Does this path decide Prettier's verdict for files other than itself?
 * Mirrors `scripts/guard-push.mjs` so CI and the pre-push hook escalate the same
 * policy-file set (a changed-paths-only check cannot see tree-wide drift).
 */
function carriesPrettierField(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")).prettier !== undefined;
  } catch {
    // Unparseable: assume it is policy rather than assume it is not.
    return true;
  }
}

function isPrettierPolicyFile(filePath) {
  const base = path.basename(filePath);
  if (/^(?:\.prettierrc(?:\..+)?|prettier\.config\.(?:js|cjs|mjs|ts)|\.prettierignore|\.editorconfig)$/.test(base)) {
    return true;
  }
  if (base !== "package.json") return false;
  return carriesPrettierField(path.join(projectRoot, filePath));
}

const scopeResult = spawnSync(process.execPath, ["scripts/ci-change-scope.mjs", "--json"], {
  cwd: projectRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
if (childProcessExitCode(scopeResult) !== 0) process.exit(childProcessExitCode(scopeResult));

const scopeFiles = JSON.parse(scopeResult.stdout).files;
// Escalate on the unfiltered list, as guard-push does: deleting .prettierignore or a
// Prettier config changes the verdict for other files even though it no longer exists.
const escalateToFullTree = scopeFiles.some((file) => isPrettierPolicyFile(file));
// Deleted paths are gone from the checkout, and prettier errors on a missing argument.
const changedFiles = scopeFiles.filter((file) => existsSync(path.join(projectRoot, file)));
if (!escalateToFullTree && changedFiles.length === 0) {
  console.log("No changed files require a formatting check.");
  process.exit(0);
}

const prettierBin = path.join(projectRoot, "node_modules", "prettier", "bin", "prettier.cjs");
const prettierArgs = escalateToFullTree
  ? ["--check", "--ignore-unknown", "."]
  : ["--check", "--ignore-unknown", "--", ...changedFiles];

if (escalateToFullTree) {
  console.log(
    "Prettier policy file changed; escalating to whole-tree format check " + "(matches scripts/guard-push.mjs).",
  );
}

const result = spawnSync(process.execPath, [prettierBin, ...prettierArgs], {
  cwd: projectRoot,
  stdio: "inherit",
});
process.exit(childProcessExitCode(result));
