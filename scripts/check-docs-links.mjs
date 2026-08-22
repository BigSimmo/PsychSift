#!/usr/bin/env node
/**
 * check-docs-links.mjs — verify that repo paths referenced in the maintained
 * documentation surface actually exist.
 *
 * Two kinds of references are checked:
 *  - Inline code spans (`docs/foo.md`, `src/bar.ts:12`) — treated as
 *    repo-root-relative paths when they start with a known top-level prefix.
 *  - Markdown link targets ([text](codebase-index.md), [text](../AGENTS.md))
 *    — resolved relative to the file containing the link and required to stay
 *    inside the repository.
 *
 * Scanned by default: README.md, AGENTS.md, and all Markdown files under docs/,
 * excluding docs/archive/, docs/audit/, dated point-in-time filenames
 * (docs/README.md classifies those as historical records that intentionally
 * reference the repo as it was), and docs/prompts/codex-cloud-review/ (verbatim
 * as-provided prompt inputs whose paths must not be edited). Pass --all to scan
 * those too (informational deeper sweep; still fails on missing paths).
 *
 * Blocking for maintained docs: runs in verify:cheap and CI. Historical
 * directories and dated point-in-time records stay excluded unless --all is
 * requested, so preserved history cannot block unrelated PRs.
 *
 * Outstanding-issues inbox citations are special: an immutable request is
 * queued at `docs/outstanding-issues-inbox/<uuid>.json` and, after reconcile,
 * lives at `docs/outstanding-issues-inbox/applied/<uuid>.json`. Ledger rows
 * (and the request's own source/detail) keep citing the pending path because
 * the JSON is immutable. Treat the applied sibling as the same file.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { applyRequestBatch, validateRequest } from "./ledger-inbox.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanAll = process.argv.includes("--all");

const ROOT_PREFIXES = [
  "docs/",
  "src/",
  "scripts/",
  "supabase/",
  "worker/",
  "tests/",
  "public/",
  ".github/",
  ".cursor/",
];

// Paths that docs intentionally reference although they do not exist:
// designed-but-unbuilt drivers and hypothetical future splits.
const ALLOWLIST = new Set([
  "scripts/reindex-shadow.ts", // designed-only harness driver (docs/reindex-shadow-harness-design.md)
  "docs/site-map.generated.md", // hypothetical future split named in docs/process-hardening.md
  // Legacy pre-(search-app) paths still cited in docs/ledger/redesign records:
  "src/app/page.tsx",
  "src/app/services/page.tsx",
  "src/app/tools/page.tsx",
  "src/app/(search-app)/tools/page.tsx",
  "src/lib/tools.ts",
  "src/components/ServiceDetailPage.tsx",
]);

// Paths a SPECIFIC document intentionally names although they do not exist, keyed by the
// document. Preferred over ALLOWLIST above, which suppresses a path everywhere: a global
// entry keeps passing if the file is later created and then deleted again, in a document
// that never meant to reference it. Scope new suppressions here unless the path is
// genuinely repo-wide.
const SCOPED_ALLOWLIST = new Map([
  [
    "docs/caring-contacts/phase-2a-sdd-archive/task-15-report.md",
    // A nested not-found route Task 15 considered and decided against after reading the
    // Next 16 docs. Naming it is the point of the paragraph.
    new Set(["src/app/caring-contacts/not-found.tsx"]),
  ],
  [
    "docs/caring-contacts/phase-2a-sdd-archive/task-18-report.md",
    // A temporary mutation probe Task 18 created, quoted the failure of, and deleted.
    new Set(["src/components/caring-contacts/workspace/overlays/guard-probe.tsx"]),
  ],
]);

/** True when `repoRelative` is allowed outright, or allowed for the document being scanned. */
function isAllowedPath(repoRelative, target) {
  if (ALLOWLIST.has(repoRelative)) return true;
  return SCOPED_ALLOWLIST.get(target)?.has(repoRelative) === true;
}

const DATED_DOC = /\b20\d{2}-\d{2}(-\d{2})?\b/;
// Historical directories: only scanned with --all.
const HISTORICAL_DIRS = new Set(["archive", "audit"]);
// Verbatim as-provided inputs: retained byte-for-byte, so their internal path
// references cannot be corrected. Only scanned with --all.
const VERBATIM_DIRS = new Set(["codex-cloud-review"]);
const APP_ROUTE_GROUPS = ["(search-app)"];
const OUTSTANDING_ISSUES = "docs/outstanding-issues.md";
const OUTSTANDING_ISSUES_INBOX = "docs/outstanding-issues-inbox";
const INBOX_REQUEST_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

/**
 * Pending inbox UUID paths keep being cited after reconcile moves the file
 * into `applied/`. Return that applied sibling, or null when the path is not
 * a pending inbox request citation.
 */
export function appliedInboxFallbackPath(repoRelative) {
  const cleaned = repoRelative.replace(/\/$/, "");
  const prefix = `${OUTSTANDING_ISSUES_INBOX}/`;
  const appliedPrefix = `${OUTSTANDING_ISSUES_INBOX}/applied/`;
  if (!cleaned.startsWith(prefix) || cleaned.startsWith(appliedPrefix)) return null;
  const name = cleaned.slice(prefix.length);
  if (name.includes("/") || !INBOX_REQUEST_NAME.test(name)) return null;
  return `${appliedPrefix}${name}`;
}

function repoPathExists(repoRelative) {
  const cleaned = repoRelative.replace(/\/$/, "");
  if (existsSync(path.join(repoRoot, cleaned))) return true;
  const applied = appliedInboxFallbackPath(cleaned);
  if (applied && existsSync(path.join(repoRoot, applied))) return true;

  if (!cleaned.startsWith("src/app/") || cleaned.includes("src/app/(")) return false;
  const appRelative = cleaned.slice("src/app/".length);
  return APP_ROUTE_GROUPS.some((group) => existsSync(path.join(repoRoot, "src/app", group, appRelative)));
}

function collectDocs(dirRelative, targets) {
  const absolute = path.join(repoRoot, dirRelative);
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const entryRelative = path.posix.join(dirRelative, entry.name);
    if (entry.isDirectory()) {
      const isSkippable = HISTORICAL_DIRS.has(entry.name) || VERBATIM_DIRS.has(entry.name);
      if (isSkippable && !scanAll) continue;
      collectDocs(entryRelative, targets);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (!scanAll && DATED_DOC.test(entry.name)) continue;
    targets.push(entryRelative);
  }
}

function defaultTargets() {
  const targets = ["README.md", "AGENTS.md"];
  collectDocs("docs", targets);
  return targets;
}

function markdownForTarget(target, absoluteTarget) {
  const markdown = readFileSync(absoluteTarget, "utf8");
  if (target !== OUTSTANDING_ISSUES) return markdown;

  // Feature branches are forbidden from editing the canonical issues ledger.
  // Validate links against the deterministic projection of its pending immutable
  // inbox instead, which is the content `issues:reconcile` will write after the
  // relevant PRs land. This keeps docs-link validation compatible with the
  // conflict-free ledger architecture without weakening either gate.
  const inbox = path.join(repoRoot, OUTSTANDING_ISSUES_INBOX);
  const requests = readdirSync(inbox)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const request = JSON.parse(readFileSync(path.join(inbox, name), "utf8"));
      const problems = validateRequest(request);
      if (problems.length > 0) {
        throw new Error(`${OUTSTANDING_ISSUES_INBOX}/${name}: ${problems.join("; ")}`);
      }
      return request;
    });
  return requests.length > 0 ? applyRequestBatch(markdown, requests).markdown : markdown;
}

function codeSpanCandidates(markdown) {
  const candidates = new Set();
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    for (const rawPiece of match[1].split(/,\s*/)) {
      candidates.add(rawPiece.trim());
    }
  }
  return candidates;
}

function linkCandidates(markdown) {
  const candidates = new Set();
  for (const match of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    candidates.add(match[1].trim());
  }
  return candidates;
}

function stripSuffixes(value) {
  let result = value;
  if (result.startsWith("./")) result = result.slice(2);
  // Drop #anchor fragments and :line / :line-line / :line:col suffixes.
  result = result.replace(/#[^#]*$/, "");
  result = result.replace(/:\d+([-:]\d+)?$/, "");
  return result;
}

function looksLikeRootPath(value) {
  if (!ROOT_PREFIXES.some((prefix) => value.startsWith(prefix))) return false;
  if (/[<>{}$\\]/.test(value)) return false; // templates/placeholders
  if (value.includes("*")) return false; // globs checked via their base dir below
  if (value.includes("...")) return false; // ellipsis placeholders like src/app/api/...
  if (/\s/.test(value)) return false;
  // Require a file extension or an explicit trailing slash so that
  // non-path tokens sharing a prefix (e.g. the `supabase/postgres` Docker
  // image) are not misread as repo paths. Extensionless directory mentions
  // are simply skipped, never failed.
  const lastSegment = value.replace(/\/$/, "").split("/").pop() ?? "";
  if (!value.endsWith("/") && !lastSegment.includes(".")) return false;
  return true;
}

function globBaseDir(value) {
  const starIndex = value.indexOf("*");
  if (starIndex === -1) return null;
  const base = value.slice(0, starIndex);
  const lastSlash = base.lastIndexOf("/");
  return lastSlash === -1 ? null : base.slice(0, lastSlash);
}

function isExternalLink(value) {
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(value) || value.startsWith("#");
}

function main() {
  let missing = 0;
  let checked = 0;

  for (const target of defaultTargets()) {
    const absoluteTarget = path.join(repoRoot, target);
    if (!existsSync(absoluteTarget)) continue;
    const markdown = markdownForTarget(target, absoluteTarget);
    const targetDir = path.posix.dirname(target);
    const failures = [];

    const check = (repoRelative, label) => {
      if (isAllowedPath(repoRelative, target)) return;
      checked += 1;
      if (!repoPathExists(repoRelative)) failures.push(label);
    };

    // Inline code spans: repo-root-relative repo paths.
    for (const rawCandidate of codeSpanCandidates(markdown)) {
      const value = stripSuffixes(rawCandidate);
      const base = ROOT_PREFIXES.some((prefix) => value.startsWith(prefix)) ? globBaseDir(value) : null;
      if (base !== null) {
        if (isAllowedPath(value, target)) continue;
        checked += 1;
        if (!existsSync(path.join(repoRoot, base))) failures.push(`${value} (glob base '${base}' missing)`);
        continue;
      }
      if (!looksLikeRootPath(value)) continue;
      check(value, value);
    }

    // Markdown link targets: repo docs use both repo-root-relative targets
    // (`src/lib/env.ts`) and file-relative targets (`codebase-index.md`,
    // `../AGENTS.md`). Accept whichever resolves, confined to the repository.
    for (const rawCandidate of linkCandidates(markdown)) {
      if (isExternalLink(rawCandidate)) continue;
      const value = stripSuffixes(rawCandidate);
      if (value === "" || value.includes("*") || /[<>{}$\\]/.test(value) || /\s/.test(value)) continue;
      const relative = path.posix.normalize(path.posix.join(targetDir === "." ? "" : targetDir, value));
      if (relative.startsWith("..")) {
        checked += 1;
        failures.push(`${rawCandidate} (escapes repository root)`);
        continue;
      }
      const rootStyle = path.posix.normalize(value);
      const candidates = rootStyle === relative || rootStyle.startsWith("..") ? [relative] : [rootStyle, relative];
      if (candidates.some((candidate) => isAllowedPath(candidate, target))) continue;
      checked += 1;
      const found = candidates.some((candidate) => repoPathExists(candidate));
      if (!found)
        failures.push(rawCandidate === relative ? relative : `${rawCandidate} (tried ${candidates.join(", ")})`);
    }

    if (failures.length > 0) {
      missing += failures.length;
      console.error(`\n${target}:`);
      for (const failure of failures) console.error(`  MISSING ${failure}`);
    }
  }

  if (missing > 0) {
    console.error(`\ndocs link check FAILED: ${missing} missing path(s) across ${checked} checked references.`);
    process.exit(1);
  }

  console.log(`docs link check passed: ${checked} repo path references resolve.`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
