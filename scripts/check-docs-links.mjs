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
 * Scanned by default: README.md, AGENTS.md, bundled Cloud-profile skill links,
 * and all Markdown files under docs/,
 * excluding docs/archive/, docs/audit/, dated point-in-time filenames
 * (docs/README.md classifies those as historical records that intentionally
 * reference the repo as it was), and docs/prompts/codex-cloud-review/ (verbatim
 * as-provided prompt inputs whose paths must not be edited). Pass --all to scan
 * those too (informational deeper sweep; still fails on missing paths).
 *
 * Blocking for maintained docs and bundled skills: runs in docs:check-links and CI. Historical
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
import { fileURLToPath } from "node:url";

import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";
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
    "docs/plans/edge-ingestion-overhaul-3pr-plan.md",
    // A dated plan whose baseline and first step name the retired ingestion-worker Edge
    // Function; the folder was deleted as that step's follow-up, so the path is the record.
    new Set(["supabase/functions/ingestion-worker/"]),
  ],

  // ── Automations removed 2026-09-17 (owner-approved). Each document below is a frozen
  // historical record (a decision doc, the outstanding-issues ledger, or a dated rollout plan)
  // whose past-tense text names a workflow that genuinely existed at the time it was written and
  // has since been deleted. Rewriting the historical text to hide that it once existed would
  // falsify the record; the ledger and decision-doc write-discipline guards separately forbid
  // editing their rows/prose at all.
  [
    "docs/decisions/ccz4hb-review-coverage.md",
    // Cites the (now-deleted) Codex auto-resolve workflow as part of the 2026-08-22/2026-09-02
    // review-coverage analysis this decision record preserves verbatim.
    new Set([".github/workflows/codex-autofix-review-comments.yml"]),
  ],
  [
    "docs/outstanding-issues.md",
    // Row #138/#160, RESOLVED 2026-07-31: "CI Triage ships inert pending a repo variable" /
    // "ci-triage.yml enables by default". The workflow existed and was enabled at close time;
    // it was deleted 2026-09-17 as part of the automations-removal sweep. Frozen historical row.
    //
    // Row #BDJWAH names `src/lib/owner-catalogue-cache.ts` as the module whose only search-path
    // reader was removed on 2026-09-09 — the commit behind the seven-day registry-search outage.
    // The module was retired under that row on 2026-09-19, which is the row doing its job, not a
    // stale reference: its whole subject is a file that should not exist. Rewriting the row to a
    // path that resolves would delete the sentence's subject, and the ledger write-discipline
    // guard forbids editing the row at all.
    new Set([".github/workflows/ci-triage.yml", "src/lib/owner-catalogue-cache.ts"]),
  ],
  [
    "docs/plans/tooling-activation-implementation-plan.md",
    // SC-A2 named the (now-deleted) GitHub CI-failure notifier as a 2026-08-01 rollout success
    // criterion. The workflow was built, ran, and was deleted 2026-09-17; the plan is a
    // point-in-time record of what was proposed, not a live task list.
    //
    // C1 also named the screenshot pack folder `public/mockups/mode-page-redesign-2026-07/current/`,
    // which was cleared when unreferenced historical PNGs were removed; the parent README remains.
    new Set([".github/workflows/notify-ci-failure.yml", "public/mockups/mode-page-redesign-2026-07/current/"]),
  ],
  ["docs/care-plan/reports/task-3-brief.md", new Set(["src/components/care-plan/mockups/index.ts"])],
  ["docs/care-plan/reports/task-3-report.md", new Set(["src/components/care-plan/mockups/index.ts"])],
  ["docs/care-plan/sdd-ledger.md", new Set(["src/components/care-plan/mockups/index.ts"])],
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

export function markdownAnchorSlugs(markdown) {
  const slugs = new Set();
  const slugCounts = new Map();
  for (const line of markdown.split("\n")) {
    const match = line.match(/^#{1,6}\s+(.+)$/);
    if (!match) continue;
    const headingText = match[1]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[*_~]/g, "")
      .replace(/<[^>]+>/g, "")
      .trim();
    let rawSlug = headingText
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!rawSlug) rawSlug = "section";
    const count = slugCounts.get(rawSlug) ?? 0;
    slugCounts.set(rawSlug, count + 1);
    const uniqueSlug = count === 0 ? rawSlug : `${rawSlug}-${count}`;
    slugs.add(uniqueSlug);

    const collapsedSlug = rawSlug.replace(/-+/g, "-");
    if (collapsedSlug !== rawSlug) {
      slugs.add(collapsedSlug);
    }
  }
  for (const match of markdown.matchAll(/<(?:a|span|div|section|h[1-6])[^>]+(?:id|name)=["']([^"']+)["']/gi)) {
    slugs.add(match[1].toLowerCase());
  }
  return slugs;
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
    const isSpecDoc = dirRelative === "docs/superpowers/specs" || dirRelative.startsWith("docs/superpowers/specs/");
    if (!scanAll && DATED_DOC.test(entry.name) && !isSpecDoc) continue;
    targets.push(entryRelative);
  }
}

export function defaultTargets() {
  const targets = ["README.md", "AGENTS.md"];
  collectDocs("docs", targets);
  collectDocs(".claude/cloud-profile/skills", targets);
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
  // A BACKSLASH-ESCAPED `\\]` does not close a link label — that is markdown's own rule, and
  // without the lookbehind a regex QUOTED IN A DOCUMENT is read as a link target. It happened:
  // a (since-retired) triage record quoted an import-scanning regex whose
  // `["']([^"']+)` was reported as a MISSING path. The document already escapes markdown
  // characters for its table (`\\|` for pipes); this makes the checker honour that escaping.
  for (const match of markdown.matchAll(/(?<!\\)\]\(([^)\s]+)\)/g)) {
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
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
}

function getAnchorsForFile(absPath, relPath, targetAnchorsCache) {
  if (targetAnchorsCache.has(absPath)) return targetAnchorsCache.get(absPath);
  if (!existsSync(absPath) || !relPath.endsWith(".md")) return null;
  const content = markdownForTarget(relPath, absPath);
  const anchors = markdownAnchorSlugs(content);
  targetAnchorsCache.set(absPath, anchors);
  return anchors;
}

/**
 * Check every repo-path reference (inline code spans and markdown link
 * targets) found in one document's markdown, resolving relative links
 * against the file that contains them. Returns the failure labels for that
 * document plus how many references were checked, so callers can accumulate
 * totals across documents exactly as `main()` used to inline.
 */
export function collectDocumentFailures({ target, markdown, targetAnchorsCache = new Map(), checkInlinePaths = true }) {
  let checked = 0;
  const failures = [];
  const targetDir = path.posix.dirname(target);
  const currentFileAnchors = markdownAnchorSlugs(markdown);
  targetAnchorsCache.set(path.join(repoRoot, target), currentFileAnchors);

  const check = (repoRelative, label) => {
    if (isAllowedPath(repoRelative, target)) return;
    checked += 1;
    if (!repoPathExists(repoRelative)) failures.push(label);
  };

  // Inline code spans: repo-root-relative repo paths.
  for (const rawCandidate of checkInlinePaths ? codeSpanCandidates(markdown) : []) {
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
    let targetPart = rawCandidate;
    let anchorPart = null;
    const hashIndex = targetPart.indexOf("#");
    if (hashIndex !== -1) {
      anchorPart = targetPart.slice(hashIndex + 1);
      targetPart = targetPart.slice(0, hashIndex);
    }
    targetPart = stripSuffixes(targetPart);

    if (targetPart === "") {
      // Same-document anchor link: [heading](#heading)
      if (anchorPart) {
        checked += 1;
        const normalizedAnchor = anchorPart.toLowerCase();
        if (!currentFileAnchors.has(normalizedAnchor)) {
          failures.push(`${rawCandidate} (missing anchor #${anchorPart} in ${target})`);
        }
      }
      continue;
    }

    if (targetPart.includes("*") || /[<>{}$\\]/.test(targetPart) || /\s/.test(targetPart)) continue;
    const relative = path.posix.normalize(path.posix.join(targetDir === "." ? "" : targetDir, targetPart));
    if (relative.startsWith("..")) {
      checked += 1;
      failures.push(`${rawCandidate} (escapes repository root)`);
      continue;
    }
    const rootStyle = path.posix.normalize(targetPart);
    const candidates = rootStyle === relative || rootStyle.startsWith("..") ? [relative] : [rootStyle, relative];
    if (candidates.some((candidate) => isAllowedPath(candidate, target))) continue;
    checked += 1;
    const matchingPath = candidates.find((candidate) => repoPathExists(candidate));
    if (!matchingPath) {
      failures.push(rawCandidate === relative ? relative : `${rawCandidate} (tried ${candidates.join(", ")})`);
    } else if (anchorPart && matchingPath.endsWith(".md")) {
      const absFound = path.join(repoRoot, matchingPath);
      const targetAnchors = getAnchorsForFile(absFound, matchingPath, targetAnchorsCache);
      if (targetAnchors && !targetAnchors.has(anchorPart.toLowerCase())) {
        failures.push(`${rawCandidate} (missing anchor #${anchorPart} in ${matchingPath})`);
      }
    }
  }

  return { failures, checked };
}

/** Bundled skills contain illustrative code paths, not repo-root path assertions.
 * Check their navigable Markdown links outside fenced examples. Existing docs
 * retain their original inline-path and example checking behavior.
 */
export function collectBundledSkillFailures({ target, markdown, targetAnchorsCache = new Map() }) {
  let fence = null;
  const prose = markdown
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === "") {
          fence = null;
        }
        return "";
      }
      if (marker) {
        fence = marker[1];
        return "";
      }
      return line;
    })
    .join("\n");
  return collectDocumentFailures({ target, markdown: prose, targetAnchorsCache, checkInlinePaths: false });
}

function main() {
  let missing = 0;
  let checked = 0;
  const targetAnchorsCache = new Map();

  for (const target of defaultTargets()) {
    const absoluteTarget = path.join(repoRoot, target);
    if (!existsSync(absoluteTarget)) continue;
    const markdown = markdownForTarget(target, absoluteTarget);
    const collect = target.startsWith(".claude/cloud-profile/skills/")
      ? collectBundledSkillFailures
      : collectDocumentFailures;
    const { failures, checked: checkedForTarget } = collect({
      target,
      markdown,
      targetAnchorsCache,
    });
    checked += checkedForTarget;

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

const invokedDirectly = isDirectEntrypoint(import.meta.url);
if (invokedDirectly) main();
