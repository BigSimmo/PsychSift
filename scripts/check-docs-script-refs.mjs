#!/usr/bin/env node
/**
 * check-docs-script-refs.mjs — verify that every `npm run <script>` mentioned in
 * the maintained docs corresponds to a real script in package.json.
 *
 * check-docs-links.mjs validates file PATHS referenced in docs, but nothing checks
 * the hundreds of `npm run <script>` references — so a renamed/removed script leaves
 * stale instructions that the agents (Codex/Claude/Cursor) then follow. This closes
 * that gap.
 *
 * Only references inside inline code spans (`npm run x`) and fenced code blocks are
 * scanned, so prose like "npm run the build" is never misread. Placeholder tokens
 * (containing <…>) and an explicit allowlist are skipped.
 *
 * Scans README.md, AGENTS.md, and docs/**\/*.md excluding docs/archive, docs/audit,
 * and dated point-in-time filenames (historical records). Pass --all to include them.
 *
 * Blocking for maintained docs: runs in verify:cheap and CI. Historical directories
 * and dated point-in-time records stay excluded unless --all is requested.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanAll = process.argv.includes("--all");

const DATED_DOC = /\b20\d{2}-\d{2}(-\d{2})?\b/;
const HISTORICAL_DIRS = new Set(["archive", "audit"]);

// Script tokens that appear in docs as illustrative placeholders, or real scripts
// that were renamed but are legitimately referenced in historical records (e.g. the
// branch-review-ledger "Checks" cells record what was run at the time).
const ALLOWLIST = new Set([
  "<script>",
  "<name>",
  "your-script",
  "test:e2e:advisory", // renamed to test:e2e:regression (2026-07); kept for historical ledger accuracy
]);

/** Script names defined in package.json. */
export function parsePackageScripts(pkgJsonText) {
  const pkg = JSON.parse(pkgJsonText);
  return new Set(Object.keys(pkg.scripts ?? {}));
}

/**
 * Extract `npm run <script>` tokens that appear inside inline code spans or fenced
 * code blocks. Returns the unique script names referenced. `pnpm run` / `yarn run`
 * are matched too for completeness.
 */
export function extractScriptRefs(markdown) {
  const codeRegions = [];
  for (const m of markdown.matchAll(/```[\s\S]*?```/g)) codeRegions.push(m[0]);
  for (const m of markdown.matchAll(/`[^`\n]+`/g)) codeRegions.push(m[0]);

  const names = new Set();
  for (const region of codeRegions) {
    for (const m of region.matchAll(/\b(?:npm|pnpm|yarn)\s+run\s+([A-Za-z0-9][A-Za-z0-9:_-]*)/g)) {
      names.add(m[1]);
    }
  }
  return [...names];
}

/** Referenced script names that are neither defined nor allowlisted. */
export function findStaleRefs(refs, validScripts, allowlist = ALLOWLIST) {
  return refs.filter((name) => !validScripts.has(name) && !allowlist.has(name) && !name.includes("<"));
}

function collectDocs(dirRelative, targets) {
  for (const entry of readdirSync(path.join(repoRoot, dirRelative), { withFileTypes: true })) {
    const entryRelative = path.posix.join(dirRelative, entry.name);
    if (entry.isDirectory()) {
      if (HISTORICAL_DIRS.has(entry.name) && !scanAll) continue;
      collectDocs(entryRelative, targets);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (!scanAll && DATED_DOC.test(entry.name)) continue;
    targets.push(entryRelative);
  }
}

// Root documents scanned for stale `npm run` references. The continuation holds binding
// policy split out of AGENTS.md, so its commands must stay checked too.
export const ROOT_SCRIPT_REF_DOCS = Object.freeze(["README.md", "AGENTS.md", "PROJECT-INSTRUCTIONS-CONTINUATION.md"]);

function main() {
  const validScripts = parsePackageScripts(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const targets = [...ROOT_SCRIPT_REF_DOCS];
  collectDocs("docs", targets);

  let stale = 0;
  let checked = 0;
  for (const target of targets) {
    let markdown;
    try {
      markdown = readFileSync(path.join(repoRoot, target), "utf8");
    } catch {
      continue;
    }
    const refs = extractScriptRefs(markdown);
    checked += refs.length;
    const bad = findStaleRefs(refs, validScripts);
    if (bad.length > 0) {
      stale += bad.length;
      console.error(`\n${target}:`);
      for (const name of bad) console.error(`  STALE  npm run ${name}  (no such script in package.json)`);
    }
  }

  if (stale > 0) {
    console.error(`\ndocs script-ref check FAILED: ${stale} stale reference(s) across ${checked} checked.`);
    process.exit(1);
  }
  console.log(`docs script-ref check passed: ${checked} npm-run reference(s) resolve to real scripts.`);
}

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) main();
