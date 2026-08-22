import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { appModeDefinitions, appModeHomeHref } from "@/lib/app-modes";
import {
  REPO_AWARENESS_SNAPSHOT_VERSION,
  type DocumentationSection,
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
function byPath<T extends { path: string; file: string }>(left: T, right: T) {
  return left.path.localeCompare(right.path) || left.file.localeCompare(right.file);
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
    .sort(byPath);

  const redirects = siteMap.redirects
    .map((redirect) => ({ path: redirect.route, file: redirect.file, target: redirect.target }))
    .sort(byPath);

  const api = siteMap.apiRoutes.map((route) => ({ path: route.route, file: route.file })).sort(byPath);

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
    // App-mode ids are unique by construction (they are a hand-maintained
    // enum-like registry in `app-modes.ts`), so `id` alone is already a total
    // order and needs no tiebreaker.
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    modes,
    pages,
    redirects,
    api,
    counts: {
      modes: modes.length,
      pages: pages.length,
      product_pages: pages.filter((page) => page.area === "product").length,
      mockup_pages: pages.filter((page) => page.area === "mockup").length,
      redirects: redirects.length,
      api: api.length,
    },
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
    .filter((entry) => !EXCLUDED_DOC_PREFIXES.some((prefix) => entry.startsWith(prefix)));
}

/**
 * Snapshots include tracked files only, so every checkout generates the same
 * output. An untracked Markdown document would otherwise be omitted silently
 * and let a stale snapshot look current; fail with an explicit staging
 * requirement instead. Ignored scratch notes remain outside that requirement.
 */
export function listDocumentPaths(repoRoot = process.cwd()): string[] {
  const options = { cwd: repoRoot, encoding: "utf8" as const };
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
function catalogueTargets(readmeMarkdown: string): Set<string> {
  const targets = new Set<string>();

  // Both loops below scan for `docs/…md`, and an absolute URL can contain that
  // substring — `https://github.com/…/blob/main/docs/some-doc.md` would
  // otherwise mark that document catalogued when the index never listed it.
  // Stripping URLs first is what makes the claim in this docstring true for
  // BOTH loops rather than only the link loop.
  const withoutUrls = readmeMarkdown.replace(/https?:\/\/\S+/g, " ");

  for (const match of withoutUrls.matchAll(/\]\(([^)\s#]+)/g)) {
    const target = match[1];
    if (target.includes("://") || target.startsWith("/") || target.startsWith("#")) continue;
    targets.add(path.posix.normalize(path.posix.join(DOCS_ROOT, target)));
  }

  for (const match of withoutUrls.matchAll(/docs\/[A-Za-z0-9._/-]+\.md/g)) targets.add(match[0]);

  return targets;
}

export function buildDocumentationSection(docPaths: readonly string[], readmeMarkdown: string): DocumentationSection {
  const catalogued = catalogueTargets(readmeMarkdown);

  // `path` alone is already a total order here: `docPaths` comes from
  // `git ls-files`, which cannot list the same repo path twice, so no two
  // entries can compare equal and no tiebreaker is needed.
  const documents = [...docPaths]
    .sort((left, right) => left.localeCompare(right))
    .map((repoPath) => ({
      path: repoPath,
      section: documentSection(repoPath),
      catalogued: catalogued.has(repoPath),
    }));

  const bySection = new Map<string, { name: string; documents: number; uncatalogued: number }>();
  for (const document of documents) {
    const entry = bySection.get(document.section) ?? { name: document.section, documents: 0, uncatalogued: 0 };
    entry.documents += 1;
    if (!document.catalogued) entry.uncatalogued += 1;
    bySection.set(document.section, entry);
  }
  // `name` alone is already a total order here too: it is the key of the Map
  // it was read from, so `bySection.values()` contains at most one entry per
  // name and no tiebreaker is needed.
  const sections = [...bySection.values()].sort((left, right) => left.name.localeCompare(right.name));

  return {
    documents,
    sections,
    counts: {
      documents: documents.length,
      catalogued: documents.filter((document) => document.catalogued).length,
      uncatalogued: documents.filter((document) => !document.catalogued).length,
      sections: sections.length,
    },
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
    .sort((left, right) => left.expires.localeCompare(right.expires) || left.id.localeCompare(right.id));

  return {
    note: typeof ledger.$comment === "string" ? ledger.$comment : null,
    quarantined,
    counts: { quarantined: quarantined.length },
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

export const REVIEW_RECORDS_DIR = "docs/branch-review-records";

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

export function readReviewRecordRows(dir = REVIEW_RECORDS_DIR): { file: string; line: string }[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".record.md"))
    .sort()
    .map((name) => {
      const file = `${dir}/${name}`;
      const line = readFileSync(file, "utf8")
        .split("\n")
        .map((entry) => entry.trim())
        .find((entry) => RECORD_ROW.test(entry));
      if (!line) throw new Error(`${file}: no review record row found.`);
      return { file, line };
    });
}

export function buildReviewStateSection(rows: readonly { file: string; line: string }[]): ReviewStateSection {
  const records = rows
    .map(({ file, line }) => {
      const cells = splitRecordCells(line);
      if (cells.length !== 6) {
        throw new Error(`${file}: expected 6 columns in the review record row, found ${cells.length}.`);
      }
      const [date, ref, head, scope, outcome, checks] = cells;
      // `head` is kept verbatim. Older records carry abbreviated SHAs, and
      // rejecting them would drop real reviews from the panel.
      return { date, ref, head, scope, outcome, checks };
    })
    // Newest first, then ref, head and scope. That is NOT guaranteed to be a
    // total order: 21 records in the current corpus share a date, ref AND head,
    // because one branch can be reviewed twice at one commit under different
    // scopes, and nothing structurally prevents two records sharing all four.
    //
    // Determinism therefore rests on two further facts, not on the comparator:
    // `readReviewRecordRows` sorts filenames, so its output order is the same on
    // every platform, and `Array.prototype.sort` is specified stable, so ties
    // keep that order. If either ever stops holding — records merged from a
    // second source, or an unsorted glob — this comparator will start flapping
    // the staleness gate for exactly those records, and no test will say why.
    .sort(
      (left, right) =>
        right.date.localeCompare(left.date) ||
        left.ref.localeCompare(right.ref) ||
        left.head.localeCompare(right.head) ||
        left.scope.localeCompare(right.scope),
    );

  return {
    records,
    counts: { records: records.length, refs: new Set(records.map((record) => record.ref)).size },
  };
}
