import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDirectEntrypoint } from "./lib/is-entrypoint.mjs";

import { appModeDefinitions, appModeHomeHref } from "@/lib/app-modes";
import {
  REPO_AWARENESS_SNAPSHOT_VERSION,
  type DocumentationSection,
  type RepoAwarenessSnapshot,
  type ReviewStateSection,
  type RouteArea,
  type RoutesSection,
  type TestHealthSection,
} from "@/lib/developer-area/repo-awareness-types";

import { collectSiteMapData } from "./generate-site-map";

export const SNAPSHOT_VERSION = REPO_AWARENESS_SNAPSHOT_VERSION;
export const OUTPUT_PATH = "data/repo-awareness-snapshot.json";

/**
 * Only the parts of `collectSiteMapData()`'s return value this generator reads.
 * Declared structurally rather than imported, because `generate-site-map.ts`
 * does not export its `SiteMapData` type — and narrowing here also lets a test
 * build a three-route fixture instead of walking the whole app directory.
 */
export type SiteMapInput = {
  pageRoutes: readonly { route: string; file: string }[];
  apiRoutes: readonly { route: string; file: string }[];
  redirects: readonly { route: string; file: string; target: string }[];
};

// `path` alone is not a total order: a redirect and its originating page can
// share a route path, and nothing in the input types rules out two entries
// with equal `path` in general. Break ties on `file` — every caller's array
// (`pages`, `redirects`, `api`) carries one — so a repeated regeneration on an
// unchanged repository can never reorder two entries and fail the staleness
// gate.
/**
 * A DISPERSING order, not a presentational one — the same device
 * `buildReviewStateSection` applies to `review_state.records`, applied here for
 * the same measured reason.
 *
 * Sorted by path, two routes added on two branches land next to each other
 * whenever their paths sort next to each other, and adjacent insertions are a
 * hard conflict in the committed snapshot. That is not hypothetical and not
 * rare: `/mockups/source-rail-desktop-scroll` and
 * `/mockups/specifier-record-directions` both sort under `/mockups/s`, and PR
 * #2674 conflicted on exactly that pair. A conflict here sets
 * `mergeable_state=dirty`, which suppresses `refs/pull/<n>/merge` and leaves
 * the check list empty rather than red.
 *
 * A SHA-1 of the path is uniformly distributed, so two additions land hundreds
 * of lines apart and git's three-way merge resolves both hunks untouched.
 * Alphabetical order is presentation and belongs to the page, which sorts
 * before rendering.
 *
 * The hash is a total order in practice but not by construction, so `path` and
 * `file` still break ties: two entries colliding on a SHA-1 prefix must not
 * reorder between runs and flap the staleness gate.
 */
function dispersalKey(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function byDispersedPath<T extends { path: string; file: string; target?: string }>(left: T, right: T) {
  return (
    dispersalKey(left.path).localeCompare(dispersalKey(right.path)) ||
    left.path.localeCompare(right.path) ||
    left.file.localeCompare(right.file) ||
    (left.target ?? "").localeCompare(right.target ?? "")
  );
}

export function buildRoutesSection(siteMap: SiteMapInput = collectSiteMapData()): RoutesSection {
  // A redirect route is discovered from the page routes, so it appears in both
  // lists. Listing it in `pages` as well would double-count it and tell the
  // reader a redirect stub is a page they can visit.
  const redirectPaths = new Set(siteMap.redirects.map((redirect) => redirect.route));

  const pages = siteMap.pageRoutes
    .filter((route) => !redirectPaths.has(route.route))
    .map((route) => ({
      path: route.route,
      file: route.file,
      area: (route.route.startsWith("/mockups") ? "mockup" : "product") as RouteArea,
    }))
    .sort(byDispersedPath);

  const redirects = siteMap.redirects
    .map((redirect) => ({ path: redirect.route, file: redirect.file, target: redirect.target }))
    .sort(byDispersedPath);

  const api = siteMap.apiRoutes.map((route) => ({ path: route.route, file: route.file })).sort(byDispersedPath);

  const modes = appModeDefinitions
    .map((mode) => ({
      id: mode.id,
      label: mode.label,
      home: appModeHomeHref(mode.id),
      // Some modes are hidden outside development. That is a fact about the
      // product surface a reader of this panel needs, and it is not visible
      // from the route list alone.
      dev_only: "devOnly" in mode && mode.devOnly === true,
    }))
    .sort(
      (left, right) =>
        left.id.localeCompare(right.id) || left.home.localeCompare(right.home) || left.label.localeCompare(right.label),
    );

  return {
    modes,
    pages,
    redirects,
    api,
  };
}

const DOCS_ROOT = "docs";
export const README_PATH = "docs/README.md";

/**
 * Review records get their own panel and would otherwise be 455 of the ~280
 * rows here, drowning the documents a reader is actually looking for. Inbox
 * requests are JSON transactions, not documents.
 */
const EXCLUDED_DOC_PREFIXES = ["docs/branch-review-records/", "docs/outstanding-issues-inbox/"];

function filterDocumentPaths(output: string): string[] {
  return output
    .split("\0")
    .filter((entry) => entry.endsWith(".md"))
    .filter((entry) => !EXCLUDED_DOC_PREFIXES.some((prefix) => entry.startsWith(prefix)))
    .sort((a, b) => a.localeCompare(b));
}

function scanDocsDirectory(dir: string, baseDir = dir): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanDocsDirectory(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const rel = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      results.push(rel);
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}

/**
 * Snapshots include tracked files only, so every checkout generates the same
 * output. An untracked Markdown document would otherwise be omitted silently
 * and let a stale snapshot look current; fail with an explicit staging
 * requirement instead. Ignored scratch notes remain outside that requirement.
 *
 * When git is unavailable (e.g. in a git-less container or archive), falls back
 * to scanning docs/ directly from the filesystem.
 */
export function listDocumentPaths(repoRoot = process.cwd()): string[] {
  // Annotated rather than inferred. The two sibling call sites pass their
  // options inline, so `stdio` gets `StdioOptions` from context; a standalone
  // object has no such context, and `as const` would infer a readonly tuple
  // that `execFileSync` rejects.
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: repoRoot,
    encoding: "utf8",
    // Silence git's stderr, matching `readReviewRecordRows` and
    // `readCapturedRevision`. Without it a git-less checkout takes the
    // filesystem fallback below and still prints `fatal: not a git repository`,
    // so a run that succeeded reads as a failure (`#JFRCZ4`).
    stdio: ["ignore", "pipe", "ignore"],
  };
  try {
    const untracked = filterDocumentPaths(
      execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z", "--", DOCS_ROOT], options),
    );

    if (untracked.length > 0) {
      throw new Error(
        `Untracked Markdown documents would be omitted from the repo-awareness snapshot: ${untracked.join(
          ", ",
        )}. Stage intended documents or add scratch notes to .gitignore before generating.`,
      );
    }

    return filterDocumentPaths(execFileSync("git", ["ls-files", "-z", "--", DOCS_ROOT], options));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Untracked Markdown documents")) {
      throw error;
    }
    const docsDir = path.join(repoRoot, DOCS_ROOT);
    const scanned = scanDocsDirectory(docsDir, repoRoot);
    return scanned.filter((entry) => !EXCLUDED_DOC_PREFIXES.some((prefix) => entry.startsWith(prefix))).sort();
  }
}

function documentSection(repoPath: string): string {
  // "docs/a.md" -> root; "docs/design-system/SPEC.md" -> design-system.
  const segments = repoPath.split("/");
  return segments.length > 2 ? segments[1] : "root";
}

/**
 * Every repo-relative doc path `docs/README.md` refers to, by either route it
 * uses: a markdown link written relative to `docs/`, or a full `docs/…` path
 * named in prose or a code span.
 *
 * An `http(s)://` URL is stripped before either scan runs, so neither route can
 * be fooled by a plausible-looking `docs/…md` substring inside it — a GitHub
 * blob link such as `https://github.com/…/blob/main/docs/some-doc.md` must not
 * catalogue `docs/some-doc.md`, and a document catalogued by a repository URL
 * rather than the index's own text is a false positive in the one column this
 * panel exists to report.
 *
 * Scheme-specific on purpose, and the wording says so rather than claiming
 * "absolute URLs": two narrow forms are NOT covered — a protocol-relative
 * `//host/…/docs/a.md` written as bare prose, and an `https://` URL manually
 * wrapped across two lines, since `\S+` cannot cross a newline. Neither occurs
 * in `docs/README.md`, which currently contains no URLs at all. Broadening the
 * pattern to a bare `//` was considered and rejected: it would also strip the
 * `//` of a comment inside a fenced code block, which fails in the worse
 * direction by hiding a document the index really does list.
 */
function catalogueTargets(readmeMarkdown: string): { files: Set<string>; directories: Set<string> } {
  const files = new Set<string>();
  const directories = new Set<string>();

  // Both loops below scan for `docs/…md`, and an absolute URL can contain that
  // substring — `https://github.com/…/blob/main/docs/some-doc.md` would
  // otherwise mark that document catalogued when the index never listed it.
  // Stripping URLs first is what makes the claim in this docstring true for
  // BOTH loops rather than only the link loop.
  const withoutUrls = readmeMarkdown.replace(/https?:\/\/\S+/g, " ");

  for (const match of withoutUrls.matchAll(/\]\(([^)\s#]+)/g)) {
    const target = match[1];
    if (target.includes("://") || target.startsWith("/") || target.startsWith("#")) continue;
    const normalized = path.posix.normalize(path.posix.join(DOCS_ROOT, target));
    if (target.endsWith("/")) {
      directories.add(`${normalized.replace(/\/$/, "")}/`);
    } else {
      files.add(normalized);
      if (normalized.endsWith("/README.md") && normalized !== README_PATH) {
        directories.add(normalized.slice(0, -"README.md".length));
      }
    }
  }

  for (const match of withoutUrls.matchAll(/docs\/[A-Za-z0-9._/-]+\.md/g)) {
    files.add(match[0]);
    if (match[0].endsWith("/README.md") && match[0] !== README_PATH) {
      directories.add(match[0].slice(0, -"README.md".length));
    }
  }

  return { files, directories };
}

export function buildDocumentationSection(docPaths: readonly string[], readmeMarkdown: string): DocumentationSection {
  const catalogued = catalogueTargets(readmeMarkdown);
  const isCatalogued = (repoPath: string): boolean => {
    if (catalogued.files.has(repoPath)) return true;
    for (const dirPrefix of catalogued.directories) {
      if (repoPath.startsWith(dirPrefix)) return true;
    }
    return false;
  };

  // Dispersed by a hash of the path, for the reason on `byDispersedPath` above:
  // two branches each adding a document under the same directory would
  // otherwise insert on the same lines. `path` breaks ties, and it is already a
  // total order here — `docPaths` comes from `git ls-files`, which cannot list
  // the same repo path twice — so the order is deterministic across platforms.
  // Keep hash-dispersed order from the sort above — do NOT re-sort by path.
  // A final path sort would cluster same-directory docs onto adjacent lines and
  // recreate the merge conflicts `dispersalKey` exists to prevent (AGENTS.md).
  const documents = [...docPaths]
    .sort((left, right) => dispersalKey(left).localeCompare(dispersalKey(right)) || left.localeCompare(right))
    .map((repoPath) => ({
      path: repoPath,
      section: documentSection(repoPath),
      catalogued: isCatalogued(repoPath),
    }));

  const sectionNames = new Set<string>();
  for (const document of documents) {
    sectionNames.add(document.section);
  }
  const sections = [...sectionNames].sort((left, right) => left.localeCompare(right)).map((name) => ({ name }));

  return {
    documents,
    sections,
  };
}

export const FLAKE_LEDGER_PATH = "tests/flake-ledger.json";

export type FlakeLedgerFile = { $comment?: string; flakes: readonly Record<string, unknown>[] };

function requireString(entry: Record<string, unknown>, field: string): string {
  const value = entry[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`flake ledger entry ${String(entry.id ?? "(no id)")} is missing "${field}".`);
  }
  return value;
}

export function buildTestHealthSection(ledger: FlakeLedgerFile): TestHealthSection {
  const quarantined = ledger.flakes
    // These ten calls ARE the required-field list, mirroring `requiredFields`
    // in `scripts/flake-ledger.mjs`. A separate validation loop would be dead
    // code, since every field is read — and therefore checked — right here.
    .map((entry) => {
      return {
        id: requireString(entry, "id"),
        title: requireString(entry, "title"),
        spec: requireString(entry, "spec"),
        reason: requireString(entry, "reason"),
        owner: requireString(entry, "owner"),
        reproduction: requireString(entry, "reproduction"),
        first_seen: requireString(entry, "firstSeen"),
        last_seen: requireString(entry, "lastSeen"),
        expires: requireString(entry, "expires"),
        tracking: requireString(entry, "tracking"),
      };
    })
    // Soonest expiry first: the quarantine closest to lapsing is the one that
    // needs a decision. `id` breaks ties, and `id` is unique because
    // `validateFlakeLedgerEntries` in `scripts/flake-ledger.mjs` enforces that —
    // this module never checks it itself. `Array.prototype.sort` is specified
    // as stable, so even if that external guarantee ever lapsed, a duplicate
    // `id` could only ever tie deterministically, never reorder between runs.
    .sort(
      (left, right) =>
        left.expires.localeCompare(right.expires) ||
        left.id.localeCompare(right.id) ||
        left.spec.localeCompare(right.spec) ||
        left.title.localeCompare(right.title),
    );

  return {
    note: typeof ledger.$comment === "string" ? ledger.$comment : null,
    quarantined,
  };
}

export function readFlakeLedger(ledgerPath = FLAKE_LEDGER_PATH): FlakeLedgerFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(ledgerPath, "utf8"));
  } catch (error) {
    throw new Error(`${ledgerPath}: could not be read or parsed — ${(error as Error).message}`);
  }
  const ledger = parsed as FlakeLedgerFile;
  if (!Array.isArray(ledger?.flakes)) {
    throw new Error(
      `${ledgerPath}: expected a "flakes" array; a corrupt ledger must not silently become an empty panel.`,
    );
  }
  return ledger;
}

export const REVIEW_LEDGER_PATH = "docs/branch-review-ledger.md";
export const REVIEW_ARCHIVE_PATHSPEC = ":(glob)docs/archive/branch-review-ledger-*.md";
export const REVIEW_RECORDS_DIR = "docs/branch-review-records";
export const REVIEW_RECORDS_PATHSPEC = ":(glob)docs/branch-review-records/*.record.md";

const RECORD_ROW = /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/;

/**
 * Escape-aware, and it unescapes as it goes. Deliberately NOT `splitCells` from
 * `scripts/outstanding-issues.mjs`, for two independent reasons:
 *
 *  1. That module is JavaScript with no type declarations, so importing it here
 *     would put an implicit `any` into a strict TypeScript build.
 *  2. It deliberately PRESERVES `\|` because the ledger tooling round-trips
 *     cells back into markdown, and unescaping there would emit a bare pipe
 *     into a table row and corrupt `issues:reconcile`. This snapshot is a
 *     one-way export, so it must do the opposite — the same split Phase 1
 *     documented when it put `unescapeCell` in the generator rather than in the
 *     shared splitter.
 *
 * `tests/repo-awareness-generator.test.ts` runs the whole committed corpus
 * through this function, so a divergence in behaviour fails on real data.
 */
function splitRecordCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  for (let index = 0; index < inner.length; index += 1) {
    if (inner[index] === "\\" && inner[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (inner[index] === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += inner[index];
  }
  cells.push(cell.trim());
  return cells;
}

function findReviewFilesFs(dir = REVIEW_RECORDS_DIR): string[] {
  const files: string[] = [];
  if (path.isAbsolute(dir)) {
    if (existsSync(dir)) {
      const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push(path.join(dir, entry.name));
        }
      }
    }
  } else {
    if (existsSync(REVIEW_LEDGER_PATH)) {
      files.push(REVIEW_LEDGER_PATH);
    }
    const archiveDir = "docs/archive";
    if (existsSync(archiveDir)) {
      const entries = readdirSync(archiveDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (entry.isFile() && entry.name.startsWith("branch-review-ledger-") && entry.name.endsWith(".md")) {
          files.push(path.posix.join(archiveDir, entry.name));
        }
      }
    }
    if (existsSync(REVIEW_RECORDS_DIR)) {
      const entries = readdirSync(REVIEW_RECORDS_DIR, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".record.md")) {
          files.push(path.posix.join(REVIEW_RECORDS_DIR, entry.name));
        }
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * Read the same complete, tracked review corpus as `ledger:lookup`: the frozen
 * live table, rotated archives, and immutable records. Walking the filesystem
 * would list a developer's untracked draft records, and the staleness gate
 * would then fail on a clean tree for everyone but that developer — the same
 * failure `listDocumentPaths` exists to prevent.
 *
 * When git is unavailable (e.g. in a git-less container or archive), falls back
 * to scanning the review paths directly from the filesystem.
 */
export function readReviewRecordRows(dir = REVIEW_RECORDS_DIR): { file: string; line: string }[] {
  // An absolute `dir` is a throwaway fixture (the generator always uses the
  // repo-relative default). Isolate `git ls-files` to that directory so the
  // fixture can be its own tiny repository.
  const cwd = path.isAbsolute(dir) ? dir : undefined;
  const pathspecs = cwd ? ["."] : [REVIEW_LEDGER_PATH, REVIEW_ARCHIVE_PATHSPEC, REVIEW_RECORDS_PATHSPEC];
  let files: string[] = [];
  try {
    const output = execFileSync("git", ["ls-files", "-z", "--", ...pathspecs], {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    files = output
      .split("\0")
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((entry) => (cwd ? path.join(dir, entry) : entry));
  } catch {
    files = findReviewFilesFs(dir);
  }

  return files.flatMap((file) => {
    const lines = readFileSync(file, "utf8")
      .split("\n")
      .map((row) => row.trim())
      .filter((row) => RECORD_ROW.test(row));
    if (lines.length === 0) throw new Error(`${file}: no review record row found.`);
    return lines.map((line) => ({ file, line }));
  });
}

export function buildReviewStateSection(rows: readonly { file: string; line: string }[]): ReviewStateSection {
  const records = rows
    .map(({ file, line }) => {
      const cells = splitRecordCells(line);
      if (cells.length !== 6) {
        throw new Error(`${file}: expected 6 columns in the review record row, found ${cells.length}.`);
      }
      const [date, ref, rawHead, scope, outcome, checks] = cells;
      // Match the canonical ledger parser: legacy table rows sometimes wrap
      // SHAs in Markdown code spans. Strip that presentation syntax while
      // preserving abbreviated and full SHAs.
      const head = rawHead.replaceAll("`", "");
      return { date, ref, head, scope, outcome, checks };
    })
    // Ordered by `head` — a DISPERSING key, not a presentational one. This is
    // the whole point of the ordering, so do not "restore" newest-first here.
    //
    // The corpus holds 2,662 records across only 53 distinct dates, so a
    // date-descending order put every new record into the same dense block at
    // the head of the array. Two branches each appending one review record —
    // the ordinary handoff — therefore inserted on the same lines and produced
    // a hard conflict in the committed snapshot, which sets
    // `mergeable_state=dirty` on GitHub. That suppresses `refs/pull/<n>/merge`,
    // so `pull_request` CI does not run at all and the check list reads empty
    // rather than red (`#EFETZT`; twice in fifteen minutes on PR #2413).
    //
    // A commit sha is uniformly distributed hex — 2,323 distinct values here —
    // so concurrent appends land hundreds of lines apart and git's three-way
    // merge resolves both hunks with no conflict. Newest-first is presentation
    // and belongs to the page: `ReviewStatePageContent` sorts before paginating.
    //
    // `head` alone is NOT a total order — a branch reviewed twice at one commit
    // under different scopes repeats it — so date, ref and scope break ties.
    // Even those four are not provably total, and determinism therefore rests
    // on two further facts, not on the comparator: `readReviewRecordRows` sorts
    // filenames and preserves row order within each file, so its output order
    // is the same on every platform, and `Array.prototype.sort` is specified
    // stable, so ties keep that order. If either ever stops holding — records
    // merged from a second source, or an unsorted glob — this comparator will
    // start flapping the staleness gate for exactly those records, and no test
    // will say why.
    .sort(
      (left, right) =>
        left.head.localeCompare(right.head) ||
        left.date.localeCompare(right.date) ||
        left.ref.localeCompare(right.ref) ||
        left.scope.localeCompare(right.scope) ||
        left.outcome.localeCompare(right.outcome) ||
        left.checks.localeCompare(right.checks),
    );

  // No `counts` here, deliberately — see `ReviewStateSection` in
  // `repo-awareness-types.ts`. An aggregate over an append-only set changes on
  // BOTH sides of every concurrent append, so a stored count is a guaranteed
  // conflict no ordering can disperse. `reviewStateCounts()` derives it once at
  // render instead, so a count and its own list still cannot disagree.
  return { records };
}

/**
 * The commit that last touched anything this snapshot describes — not `HEAD`.
 *
 * `HEAD` would advance on every unrelated commit, so the page would claim the
 * data was fresher than it is. Dating the snapshot by its own inputs can only
 * ever understate freshness, which is the safe direction and the same choice
 * Phase 1 made for `ledger_revision`.
 *
 * This list may only ever contain files that genuinely shape emitted data —
 * never widened to a transitive-closure chase or a broad directory "to be
 * safe." The two directions are not symmetric:
 *
 *  - Adding a TRUE input is always safe. It can only move the resolved commit
 *    forward, toward the commit that actually last changed something here —
 *    which is always an improvement in accuracy, never a risk.
 *  - Adding something that is NOT an input is unsafe. An unrelated commit
 *    would then advance the date, and the page would claim the data is
 *    FRESHER than it actually is — the one direction this scheme exists to
 *    rule out.
 *  - Omitting a true input is merely imprecise, and imprecise in the safe
 *    direction: the date understates freshness rather than overstating it.
 *    That is why growing this list is a correctness improvement, not a bug
 *    fix — nothing here was ever unsafe, just less accurate than it could be.
 *
 * `scripts/generate-site-map.ts` and `src/lib/consolidated-mode-home-redirect.ts`
 * were added after confirming each one flows into an emitted field:
 * `documentedRedirectTargets` (generate-site-map.ts) is consumed while
 * building `routes.redirects[].target`, and `consolidatedModeHomeModeIds`
 * (consolidated-mode-home-redirect.ts) is branched on by `appModeHomeHref()`
 * while building every mode's `home` field below. `src/lib/document-flow-routes.ts`
 * (`documentsSearchHref`) and `src/lib/search-navigation-context.ts`
 * (`appendSearchNavigationContext`) were deliberately left out: `appModeHomeHref`
 * is always called here with no second argument, so `options` is always `{}` —
 * the `documentsSearchHref` branch requires a truthy `query`, which is never
 * present, so it never runs; and `appendSearchNavigationContext` hits its
 * `!filters` early return on every call here, so it always returns its input
 * `URLSearchParams` unchanged. Neither file's content can currently reach an
 * emitted field through this call site.
 *
 * Docs are a `*.md` glob rather than the `docs/` directory: inbox JSON and
 * other non-emitted files under that tree must not advance the stamp.
 *
 * The review corpus is excluded from that glob, mirroring `EXCLUDED_DOC_PREFIXES`.
 * Appending a review record writes `docs/branch-review-records/<sha>.record.md`,
 * which the bare glob matched — so every handoff moved this stamp on both the
 * feature branch and `main`, and two lines that always differ are a conflict no
 * amount of dispersal in `review_state.records` can avoid (`#EFETZT`). Dropping
 * a true input is the sanctioned direction stated above: it can only understate
 * freshness, never overstate it. The rotated archives go with it for the same
 * reason.
 */
const REVISION_INPUTS = [
  "src/app",
  "src/lib/app-modes.ts",
  "src/lib/consolidated-mode-home-redirect.ts",
  ":(glob)docs/**/*.md",
  ":(exclude,glob)docs/branch-review-records/**",
  ":(exclude,glob)docs/archive/branch-review-ledger-*.md",
  "tests/flake-ledger.json",
  "scripts/generate-site-map.ts",
];

/**
 * The commit DATE, never a timestamp and never the sha — see `captured_revision`
 * in `repo-awareness-types.ts`. `%cI` is read rather than `%cs` so that a
 * snapshot written by an older generator, which stored the full ISO instant,
 * still narrows to the same date here instead of being rejected outright.
 */
export function toRevisionDate(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/u.exec(value);
  return match ? match[1] : null;
}

export function readCommittedRevision(path = OUTPUT_PATH): { committed_at: string } | null {
  try {
    const revision = JSON.parse(readFileSync(path, "utf8")).captured_revision;
    if (typeof revision?.committed_at !== "string") return null;
    const committed_at = toRevisionDate(revision.committed_at);
    return committed_at ? { committed_at } : null;
  } catch {
    return null;
  }
}

export function readCapturedRevision({
  cwd,
  snapshotPath = OUTPUT_PATH,
}: { cwd?: string; snapshotPath?: string } = {}): { committed_at: string } | null {
  let output = "";
  try {
    output = execFileSync("git", ["log", "-1", "--format=%H%x09%cI", "--", ...REVISION_INPUTS], {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Git is unavailable or not a git repository; fall back to reading committed snapshot.
  }
  if (output) {
    const [, committedAt] = output.split("\t");
    const committed_at = committedAt ? toRevisionDate(committedAt) : null;
    if (committed_at) return { committed_at };
  }
  const resolvedSnapshotPath = cwd ? path.join(cwd, snapshotPath) : snapshotPath;
  return readCommittedRevision(resolvedSnapshotPath);
}

export function generate(): RepoAwarenessSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    captured_revision: readCapturedRevision(),
    routes: buildRoutesSection(),
    documentation: buildDocumentationSection(listDocumentPaths(), readFileSync(README_PATH, "utf8")),
    test_health: buildTestHealthSection(readFlakeLedger()),
    review_state: buildReviewStateSection(readReviewRecordRows()),
  };
}

// Windows-safe main-module check, matching the convention used elsewhere in
// scripts/: a manual `file://${argv[1]}` string reconstruction never matches
// `import.meta.url` on Windows, because a relative argv[1] stays relative and an
// absolute one is missing the drive-letter leading slash — the guard would
// silently never fire and the file would never be written.
async function main() {
  if (process.argv.includes("--check")) {
    const { checkRepoAwarenessSnapshot } = await import("./check-repo-awareness-snapshot");
    const exitCode = checkRepoAwarenessSnapshot();
    if (exitCode !== 0) process.exit(exitCode);
  } else {
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(generate(), null, 2)}\n`, "utf8");
    console.log(`[repo-awareness] wrote ${OUTPUT_PATH}`);
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
