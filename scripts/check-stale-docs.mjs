#!/usr/bin/env node
/**
 * check-stale-docs — report Markdown docs nobody has touched or linked to in a long time.
 *
 * It never deletes anything. It exists because a 2026-08-31 productivity review found the
 * docs/ tree had grown to 1,121 files with no process to notice when one goes stale, and a
 * naive "last commit per file" count is meaningless on a shallow clone — this script refuses
 * to run on one rather than reporting a false "everything was touched once" picture (the same
 * trap scripts/check-dead-code-candidate.mjs was written to avoid for code).
 *
 * A doc is flagged only when BOTH hold:
 *   - its last commit is older than --days (default 180), and
 *   - its own relative path does not appear as a substring in any other tracked text file
 *     (so nothing links to it, mentions it, or names it in a script/test/workflow).
 *
 * Flagged means "worth a human look" — it may be a deliberately stable reference doc, not
 * dead weight. This script does not know the difference; a person does. It still exits 1
 * when it finds any, so a stale unreferenced doc cannot pass unnoticed.
 *
 * Usage:
 *   node scripts/check-stale-docs.mjs                 # human-readable report
 *   node scripts/check-stale-docs.mjs --json           # machine-readable report
 *   node scripts/check-stale-docs.mjs --days 90
 *
 * Exit 1 when any stale doc is found, and on a hard failure to inspect the repo (shallow
 * clone, git not runnable). Exit 0 when every scanned doc was touched recently or is referenced.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// Directories that are deliberately append-only or archival — staleness there is the point,
// not a problem. Keep this list in sync with AGENTS.md's "immutable ledger" conventions.
const EXCLUDED_PREFIXES = [
  "docs/branch-review-records/",
  "docs/outstanding-issues-inbox/",
  "docs/archive/",
  "docs/adr/", // architecture decision records are intentionally frozen once accepted
  // A plan/spec with unchecked tasks is scaffolding, not debris — the same reason
  // scripts/check-dead-code-candidate.mjs refuses to call a symbol dead when a plan here
  // still names it. Confirmed on 2026-08-31: two of three docs this scanner flagged in
  // this pair of directories had 44 and 22 unchecked "- [ ]" tasks respectively.
  "docs/superpowers/plans/",
  "docs/superpowers/specs/",
];

function sh(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

/** Resolve a Markdown link destination to a repo-relative posix path, or null if external. */
export function resolveMarkdownLink(fromFile, linkDest) {
  const dest = String(linkDest || "")
    .replace(/^<|>$/g, "")
    .split("#")[0]
    .split("?")[0]
    .trim();
  if (!dest || /^(https?:|mailto:|file:)/i.test(dest)) return null;
  if (dest.startsWith("/")) return dest.replace(/^\/+/, "");

  const fromDir = dirname(fromFile).replace(/\\/g, "/");
  const parts = [...fromDir.split("/").filter(Boolean), ...dest.replace(/\\/g, "/").split("/")];
  const stack = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

export function historyIsComplete() {
  const state = sh(["rev-parse", "--is-shallow-repository"]).trim().toLowerCase();
  if (state === "true") return false;
  if (state === "false") return true;
  throw new Error(`git rev-parse returned an unexpected shallow-repository state: ${state || "<empty>"}`);
}

export function parseDaysArg(argv, fallback = 180) {
  const flagIndex = argv.indexOf("--days");
  if (flagIndex === -1) return fallback;
  const value = Number(argv[flagIndex + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--days must be a non-negative number, got: ${argv[flagIndex + 1]}`);
  }
  return value;
}

export function listTrackedDocs() {
  return sh(["ls-files", "docs/*.md", "docs/**/*.md"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => !EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix)));
}

export function lastCommitDate(path) {
  const raw = sh(["log", "-1", "--format=%ad", "--date=iso-strict", "--", path]).trim();
  return raw ? new Date(raw) : null;
}

// Generated catalogs mention nearly every path in the repo by construction — being listed
// in one is proof a file exists, not proof anyone is reading or relying on it.
const GENERATED_CATALOGS = new Set([
  "docs/site-map.md",
  "docs/branch-review-index.md",
  "data/repo-awareness-snapshot.json",
  "data/outstanding-issues-snapshot.json",
]);

const MARKDOWN_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

export function isReferencedElsewhere(path, allTrackedFiles, fileCache) {
  for (const other of allTrackedFiles) {
    if (other === path) continue;
    if (GENERATED_CATALOGS.has(other)) continue;
    if (
      !other.endsWith(".md") &&
      !other.endsWith(".ts") &&
      !other.endsWith(".tsx") &&
      !other.endsWith(".mjs") &&
      !other.endsWith(".yml") &&
      !other.endsWith(".yaml") &&
      !other.endsWith(".json") &&
      !other.endsWith(".sh")
    ) {
      continue;
    }
    let body = fileCache.get(other);
    if (body === undefined) {
      try {
        body = readFileSync(resolve(root, other), "utf8");
      } catch {
        body = "";
      }
      fileCache.set(other, body);
    }
    if (body.includes(path)) return true;

    // Relative Markdown links like `(testing.md)` from `docs/process-hardening.md`.
    if (other.endsWith(".md")) {
      MARKDOWN_LINK_RE.lastIndex = 0;
      let match;
      while ((match = MARKDOWN_LINK_RE.exec(body)) !== null) {
        const resolved = resolveMarkdownLink(other, match[1]);
        if (resolved === path) return true;
      }
    }
  }
  return false;
}

export function findStaleDocs({ days = 180, now = new Date() } = {}) {
  if (!historyIsComplete()) {
    throw new Error(
      "Refusing to run on a shallow clone — commit dates are meaningless here. Run `git fetch --deepen=3000` (or an unshallow fetch) first.",
    );
  }
  const cutoffMs = now.getTime() - days * 24 * 60 * 60 * 1000;
  const allTracked = sh(["ls-files"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const docs = listTrackedDocs();
  const fileCache = new Map();
  const stale = [];
  for (const doc of docs) {
    const lastTouched = lastCommitDate(doc);
    if (!lastTouched || lastTouched.getTime() > cutoffMs) continue;
    if (isReferencedElsewhere(doc, allTracked, fileCache)) continue;
    stale.push({ path: doc, lastTouched: lastTouched.toISOString().slice(0, 10) });
  }
  return { totalDocsScanned: docs.length, stale };
}

/** 1 when the report lists any stale doc. A printed list is not a pass. */
export function exitStatusForStaleReport(result) {
  return result?.stale?.length > 0 ? 1 : 0;
}

function main() {
  const argv = process.argv.slice(2);
  const days = parseDaysArg(argv);
  const json = argv.includes("--json");

  let result;
  try {
    result = findStaleDocs({ days });
  } catch (error) {
    console.error(`check-stale-docs: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.stale.length === 0) {
    console.log(
      `check-stale-docs: none of ${result.totalDocsScanned} scanned docs are both untouched for ${days}+ days and unreferenced elsewhere.`,
    );
  } else {
    console.log(
      `check-stale-docs: ${result.stale.length} of ${result.totalDocsScanned} docs are untouched for ${days}+ days AND not referenced by anything else in the repo. Worth a human look, not an automatic delete:\n`,
    );
    for (const { path, lastTouched } of result.stale) {
      console.log(`  ${lastTouched}  ${path}`);
    }
  }
  const status = exitStatusForStaleReport(result);
  if (status !== 0) process.exit(status);
}

if (isDirectEntrypoint(import.meta.url)) {
  main();
}
