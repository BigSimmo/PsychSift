import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  documentationCounts,
  routesCounts,
  testHealthCounts,
} from "@/lib/developer-area/repo-awareness-snapshot-counts";

import { appModeDefinitions } from "@/lib/app-modes";
import { removePathSync } from "../scripts/retryable-fs.mjs";
import {
  buildDocumentationSection,
  buildReviewStateSection,
  buildRoutesSection,
  buildTestHealthSection,
  generate,
  listDocumentPaths,
  readCapturedRevision,
  readCommittedRevision,
  readFlakeLedger,
  readReviewRecordRows,
  SNAPSHOT_VERSION,
  type SiteMapInput,
} from "../scripts/generate-repo-awareness-snapshot";

const SITE_MAP: SiteMapInput = {
  pageRoutes: [
    { route: "/dsm", file: "src/app/(search-app)/dsm/page.tsx" },
    { route: "/mockups/development", file: "src/app/mockups/development/page.tsx" },
    { route: "/tools", file: "src/app/tools/page.tsx" },
  ],
  apiRoutes: [{ route: "/api/answer", file: "src/app/api/answer/route.ts" }],
  redirects: [{ route: "/tools", file: "src/app/tools/page.tsx", target: "/" }],
};

describe("buildRoutesSection", () => {
  it("separates product pages from mockup pages", () => {
    const section = buildRoutesSection(SITE_MAP);
    // Compared order-insensitively: pages are stored dispersed by a hash of the
    // path, so array position is deliberately not alphabetical. What this test
    // is about is the area classification, not the ordering.
    expect([...section.pages].sort((left, right) => left.path.localeCompare(right.path))).toEqual([
      { path: "/dsm", file: "src/app/(search-app)/dsm/page.tsx", area: "product" },
      { path: "/mockups/development", file: "src/app/mockups/development/page.tsx", area: "mockup" },
    ]);
  });

  it("moves a redirect out of pages so it is listed once, under redirects", () => {
    const section = buildRoutesSection(SITE_MAP);
    expect(section.pages.map((page) => page.path)).not.toContain("/tools");
    expect(section.redirects).toEqual([{ path: "/tools", file: "src/app/tools/page.tsx", target: "/" }]);
  });

  it("carries every app mode with a home href", () => {
    const section = buildRoutesSection(SITE_MAP);
    expect(section.modes).toHaveLength(appModeDefinitions.length);
    for (const mode of section.modes) {
      expect(mode.home).toMatch(/^\//);
      expect(mode.label.length).toBeGreaterThan(0);
      expect(typeof mode.dev_only).toBe("boolean");
    }
  });

  it("computes counts from the arrays it emits, so a count cannot disagree with its list", () => {
    const section = buildRoutesSection(SITE_MAP);
    expect(routesCounts(section)).toEqual({
      modes: section.modes.length,
      pages: 2,
      product_pages: 1,
      mockup_pages: 1,
      redirects: 1,
      api: 1,
    });
  });

  it("orders every array from its content, so filesystem ordering cannot make the gate fire", () => {
    // The guarantee is DETERMINISM, not alphabetisation: whatever order the
    // site map arrives in, the snapshot must come out the same, or the
    // staleness gate flaps on an unchanged repository. Asserting a fixed
    // alphabetical list also asserted the ordering strategy, which since v3 is
    // dispersal by path hash. Comparing shuffled input against unshuffled input
    // tests the property itself and survives a future change of strategy.
    const shuffled: SiteMapInput = {
      ...SITE_MAP,
      pageRoutes: [...SITE_MAP.pageRoutes].reverse(),
      apiRoutes: [{ route: "/api/zeta", file: "z.ts" }, ...SITE_MAP.apiRoutes],
    };
    const unshuffled: SiteMapInput = {
      ...SITE_MAP,
      apiRoutes: [...SITE_MAP.apiRoutes, { route: "/api/zeta", file: "z.ts" }],
    };
    const fromShuffled = buildRoutesSection(shuffled);
    const fromUnshuffled = buildRoutesSection(unshuffled);
    expect(fromShuffled.pages).toEqual(fromUnshuffled.pages);
    expect(fromShuffled.api).toEqual(fromUnshuffled.api);
    // And the content is all there, whatever the order.
    expect(fromShuffled.pages.map((page) => page.path).sort()).toEqual(["/dsm", "/mockups/development"]);
    expect(fromShuffled.api.map((route) => route.path).sort()).toEqual(["/api/answer", "/api/zeta"]);
  });

  it("disperses alphabetically adjacent routes, so two branches adding one do not collide", () => {
    // The property v3 exists for, on the shape that actually caused it: PR #2674
    // conflicted because /mockups/source-rail-desktop-scroll and
    // /mockups/specifier-record-directions both sort under /mockups/s and were
    // therefore inserted on the same lines by two branches.
    const adjacent = ["/mockups/sim-alpha", "/mockups/sim-alpha-two", "/mockups/sim-alpha-three"];
    const section = buildRoutesSection({
      ...SITE_MAP,
      pageRoutes: [...SITE_MAP.pageRoutes, ...adjacent.map((route) => ({ route, file: `src/app${route}/page.tsx` }))],
    });
    const positions = adjacent.map((route) => section.pages.findIndex((page) => page.path === route));
    expect(positions.every((index) => index >= 0)).toBe(true);
    // Alphabetically these three are consecutive; dispersed they must not be.
    expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThan(positions.length - 1);
  });
});

describe("listDocumentPaths", () => {
  function withTemporaryRepository(callback: (repoRoot: string) => void) {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "repo-awareness-docs-"));
    try {
      execFileSync("git", ["init", "--quiet", repoRoot]);
      mkdirSync(path.join(repoRoot, "docs"));
      writeFileSync(path.join(repoRoot, "docs", "tracked.md"), "# Tracked\n");
      execFileSync("git", ["add", "docs/tracked.md"], { cwd: repoRoot });
      callback(repoRoot);
    } finally {
      removePathSync(repoRoot, { recursive: true });
    }
  }

  it("fails closed when a non-ignored Markdown document has not been staged", () => {
    withTemporaryRepository((repoRoot) => {
      writeFileSync(path.join(repoRoot, "docs", "new.md"), "# New\n");

      expect(() => listDocumentPaths(repoRoot)).toThrow(
        "Untracked Markdown documents would be omitted from the repo-awareness snapshot: docs/new.md. Stage intended documents or add scratch notes to .gitignore before generating.",
      );
    });
  });

  it("continues to exclude ignored scratch notes", () => {
    withTemporaryRepository((repoRoot) => {
      writeFileSync(path.join(repoRoot, ".gitignore"), "docs/scratch.md\n");
      writeFileSync(path.join(repoRoot, "docs", "scratch.md"), "# Scratch\n");

      expect(listDocumentPaths(repoRoot)).toEqual(["docs/tracked.md"]);
    });
  });

  it("falls back to scanning the filesystem when git is unavailable", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "repo-awareness-docs-nogit-"));
    try {
      mkdirSync(path.join(dir, "docs", "sub"), { recursive: true });
      writeFileSync(path.join(dir, "docs", "doc1.md"), "# Doc 1\n");
      writeFileSync(path.join(dir, "docs", "sub", "doc2.md"), "# Doc 2\n");
      mkdirSync(path.join(dir, "docs", "branch-review-records"), { recursive: true });
      writeFileSync(path.join(dir, "docs", "branch-review-records", "rec.record.md"), "# Rec\n");
      mkdirSync(path.join(dir, "docs", "outstanding-issues-inbox"), { recursive: true });
      writeFileSync(path.join(dir, "docs", "outstanding-issues-inbox", "req.json"), "{}\n");

      expect(listDocumentPaths(dir)).toEqual(["docs/doc1.md", "docs/sub/doc2.md"]);
    } finally {
      removePathSync(dir, { recursive: true });
    }
  });
});

const README = `
# PsychSift Documentation Index

- [testing.md](testing.md) — how tests run
- [design-system/SPEC.md](design-system/SPEC.md) — the design system
- [an external link](https://example.com/testing.md) — not a repo doc
Referenced in prose as \`docs/rag-behaviour/README.md\` too.
`;

const DOC_PATHS = [
  "docs/testing.md",
  "docs/design-system/SPEC.md",
  "docs/design-system/GATES.md",
  "docs/rag-behaviour/README.md",
  "docs/uncatalogued.md",
];

describe("buildDocumentationSection", () => {
  it("marks a document catalogued when README links it relative to docs/", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    const byPath = new Map(section.documents.map((document) => [document.path, document]));
    expect(byPath.get("docs/testing.md")?.catalogued).toBe(true);
    expect(byPath.get("docs/design-system/SPEC.md")?.catalogued).toBe(true);
  });

  it("marks a document catalogued when README names its full repo path in prose", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    expect(section.documents.find((document) => document.path === "docs/rag-behaviour/README.md")?.catalogued).toBe(
      true,
    );
  });

  it("marks a document uncatalogued when README never names it", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    expect(section.documents.find((document) => document.path === "docs/uncatalogued.md")?.catalogued).toBe(false);
    expect(section.documents.find((document) => document.path === "docs/design-system/GATES.md")?.catalogued).toBe(
      false,
    );
  });

  it("catalogues children of linked directories without matching sibling prefixes", () => {
    const section = buildDocumentationSection(
      ["docs/guides/nested/topic.md", "docs/guides-extra/topic.md", "docs/testing.md/child.md"],
      "[Guides](./guides/) [Tests](testing.md)",
    );
    const byPath = new Map(section.documents.map((document) => [document.path, document.catalogued]));
    expect(byPath.get("docs/guides/nested/topic.md")).toBe(true);
    expect(byPath.get("docs/guides-extra/topic.md")).toBe(false);
    expect(byPath.get("docs/testing.md/child.md")).toBe(false);
  });

  it("is not fooled by a repository URL that contains a doc path", () => {
    // Removing the URL strip in `catalogueTargets` makes this red: the bare
    // regex would match `docs/only-external.md` inside the blob URL and mark a
    // document catalogued that the index never lists.
    const readme =
      "See the source at https://github.com/BigSimmo/PsychSift/blob/main/docs/only-external.md for detail.";
    const section = buildDocumentationSection(["docs/only-external.md"], readme);
    expect(section.documents[0].catalogued).toBe(false);
    expect(documentationCounts(section).uncatalogued).toBe(1);
  });

  it("does not catalogue a full doc path inside an external Markdown link", () => {
    // This is the external-link form reported in PR #2292. Without URL
    // stripping, the prose matcher would see its `docs/testing.md` suffix.
    const readme = "See [external guidance](https://example.com/docs/testing.md) for detail.";
    const section = buildDocumentationSection(["docs/testing.md"], readme);
    expect(section.documents[0].catalogued).toBe(false);
  });

  it("still catalogues a document named in ordinary prose", () => {
    // The guard against URLs must not cost us the real prose case, which is the
    // reason the second scan exists at all.
    const section = buildDocumentationSection(["docs/testing.md"], "Read `docs/testing.md` before changing a test.");
    expect(section.documents[0].catalogued).toBe(true);
  });

  it("assigns a section from the first directory under docs/, or root", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    const sections = new Map(section.documents.map((document) => [document.path, document.section]));
    expect(sections.get("docs/testing.md")).toBe("root");
    expect(sections.get("docs/design-system/SPEC.md")).toBe("design-system");
  });

  it("summarises each section and computes counts from its own arrays", () => {
    const section = buildDocumentationSection(DOC_PATHS, README);
    expect(section.sections).toEqual([{ name: "design-system" }, { name: "rag-behaviour" }, { name: "root" }]);
    expect(documentationCounts(section)).toEqual({ documents: 5, catalogued: 3, uncatalogued: 2, sections: 3 });
  });

  it("orders documents from their content, so listing order cannot make the gate fire", () => {
    // Determinism, not alphabetisation — see the routes test of the same shape.
    const fromReversed = buildDocumentationSection([...DOC_PATHS].reverse(), README);
    const fromForward = buildDocumentationSection([...DOC_PATHS], README);
    expect(fromReversed.documents).toEqual(fromForward.documents);
    expect(fromReversed.documents.map((document) => document.path).sort()).toEqual([...DOC_PATHS].sort());
  });
});

const FLAKE = {
  id: "ui-smoke-composer",
  title: "phone composer stays docked @quarantine",
  spec: "tests/ui-smoke.spec.ts",
  reason: "Sub-pixel rounding on the dock reserve",
  owner: "frontend",
  reproduction: "npm run verify:ui -- --grep composer",
  firstSeen: "2026-08-01",
  lastSeen: "2026-08-03",
  expires: "2026-09-01",
  tracking: "docs/process-hardening.md#known-flakes",
};

describe("buildTestHealthSection", () => {
  it("carries the ledger's own comment so an empty panel can say why in words", () => {
    const section = buildTestHealthSection({ $comment: "intentionally empty", flakes: [] });
    expect(section.note).toBe("intentionally empty");
    expect(section.quarantined).toEqual([]);
    expect(testHealthCounts(section)).toEqual({ quarantined: 0 });
  });

  it("uses a null note when the ledger carries no comment", () => {
    expect(buildTestHealthSection({ flakes: [] }).note).toBeNull();
  });

  it("maps every required ledger field, renaming the dates to snake case", () => {
    const section = buildTestHealthSection({ flakes: [FLAKE] });
    expect(section.quarantined).toEqual([
      {
        id: "ui-smoke-composer",
        title: "phone composer stays docked @quarantine",
        spec: "tests/ui-smoke.spec.ts",
        reason: "Sub-pixel rounding on the dock reserve",
        owner: "frontend",
        reproduction: "npm run verify:ui -- --grep composer",
        first_seen: "2026-08-01",
        last_seen: "2026-08-03",
        expires: "2026-09-01",
        tracking: "docs/process-hardening.md#known-flakes",
      },
    ]);
    expect(testHealthCounts(section).quarantined).toBe(1);
  });

  it("emits exactly the ten mapped fields, so no time-derived flag can be added quietly", () => {
    // Expiry is arithmetic against the current date. Storing it under ANY name
    // would change the snapshot's bytes daily and fail the staleness gate on an
    // unchanged repository. A `not.toHaveProperty("expired")` check pins one
    // spelling; this pins the rule, and goes red for `isExpired` or `lapsed` too.
    const section = buildTestHealthSection({ flakes: [FLAKE] });
    expect(Object.keys(section.quarantined[0]).sort()).toEqual([
      "expires",
      "first_seen",
      "id",
      "last_seen",
      "owner",
      "reason",
      "reproduction",
      "spec",
      "title",
      "tracking",
    ]);
    expect(Object.keys(testHealthCounts(section))).toEqual(["quarantined"]);
  });

  it("fails loudly and names the entry when a required field is missing or blank", () => {
    expect(() => buildTestHealthSection({ flakes: [{ ...FLAKE, owner: "" }] })).toThrow(/ui-smoke-composer.*owner/);
    expect(() => buildTestHealthSection({ flakes: [{ ...FLAKE, tracking: undefined }] })).toThrow(
      /ui-smoke-composer.*tracking/,
    );
  });

  it("sorts by expiry then id so ledger ordering cannot make the gate fire", () => {
    const later = { ...FLAKE, id: "b-later", expires: "2026-09-10" };
    const sameDay = { ...FLAKE, id: "a-same" };
    const section = buildTestHealthSection({ flakes: [later, FLAKE, sameDay] });
    expect(section.quarantined.map((entry) => entry.id)).toEqual(["a-same", "ui-smoke-composer", "b-later"]);
  });

  it("names the file when the ledger is malformed, rather than emptying the panel", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "flake-ledger-malformed-"));
    try {
      const bad = path.join(dir, "flake-ledger.json");
      writeFileSync(bad, JSON.stringify({ $comment: "no flakes key" }), "utf8");
      expect(() => readFlakeLedger(bad)).toThrow(/flake-ledger\.json: expected a "flakes" array/);
    } finally {
      removePathSync(dir, { recursive: true });
    }
  });
});

const ROW_A = {
  file: "docs/branch-review-records/aaa.record.md",
  line: "| 2026-08-15 | claude/one | 02d2e7fc839cf370b512f66b255d5f9e9b42f377 | ledger triage | Approved | ledger guards passed |",
};
const ROW_B = {
  file: "docs/branch-review-records/bbb.record.md",
  line: "| 2026-08-20 | claude/two | 639108f07aa1bcd2ee3344556677889900aabbcc | hub | Approved | 2 failed \\| 14 passed |",
};

describe("buildReviewStateSection", () => {
  it("parses the six columns of a record row", () => {
    const section = buildReviewStateSection([ROW_A]);
    expect(section.records).toEqual([
      {
        date: "2026-08-15",
        ref: "claude/one",
        head: "02d2e7fc839cf370b512f66b255d5f9e9b42f377",
        scope: "ledger triage",
        outcome: "Approved",
        checks: "ledger guards passed",
      },
    ]);
  });

  it("unescapes a markdown-escaped pipe, so no reader sees a literal backslash", () => {
    // The escape is a markdown-table artifact. Carrying it into JSON is how the
    // Phase 1 ledger page came to render "2 failed \\| 14 passed".
    const section = buildReviewStateSection([ROW_B]);
    expect(section.records[0].checks).toBe("2 failed | 14 passed");
  });

  // Do not "fix" this back to newest-first. The stored order is deliberately
  // dispersing, not presentational: a commit sha is uniformly distributed, so
  // two branches each appending one record insert hundreds of lines apart and
  // git merges both hunks. Newest-first clustered every append into the same
  // dense same-date block and produced the hard conflicts of `#EFETZT`, which
  // set `mergeable_state=dirty` and suppressed CI entirely. Reading order is
  // `reviewRecordsNewestFirst()`, applied by the page.
  it("orders by head, so concurrent appends land far apart and merge cleanly", () => {
    // ROW_A's head sorts before ROW_B's, which is the reverse of their dates —
    // so this fails if the comparator is ever restored to date-descending.
    const section = buildReviewStateSection([ROW_A, ROW_B]);
    expect(section.records.map((record) => record.ref)).toEqual(["claude/one", "claude/two"]);
  });

  it("stores no aggregate count, because one cannot merge across concurrent appends", () => {
    const again = { file: "docs/branch-review-records/ccc.record.md", line: ROW_A.line };
    const section = buildReviewStateSection([ROW_A, ROW_B, again]);
    expect(section.records).toHaveLength(3);
    expect(section).not.toHaveProperty("counts");
  });

  it("fails loudly and names the file when a row has the wrong number of columns", () => {
    const short = { file: "docs/branch-review-records/ddd.record.md", line: "| 2026-08-15 | claude/one |" };
    expect(() => buildReviewStateSection([short])).toThrow(/ddd\.record\.md/);
  });

  it("keeps an abbreviated head verbatim rather than rejecting the record", () => {
    // Older records were written with abbreviated SHAs. Rejecting them would
    // drop real reviews from the panel, which is the failure mode the
    // no-silent-drop rule exists to prevent — loudly or otherwise.
    const abbreviated = {
      file: "docs/branch-review-records/eee.record.md",
      line: "| 2026-01-02 | r | 1a2b3c4 | s | o | c |",
    };
    expect(buildReviewStateSection([abbreviated]).records[0].head).toBe("1a2b3c4");
  });

  it("normalises Markdown code spans around legacy heads", () => {
    const codeSpanned = {
      file: "docs/branch-review-ledger.md",
      line: "| 2026-01-02 | r | `0d47141fc030684299dcb265e3d853c93b9e2a91` | s | o | c |",
    };
    expect(buildReviewStateSection([codeSpanned]).records[0].head).toBe("0d47141fc030684299dcb265e3d853c93b9e2a91");
  });

  it("names the file when a record carries no parsable row", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "review-records-empty-"));
    try {
      const run = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
      run(["init", "-b", "main"]);
      writeFileSync(path.join(dir, "fff.record.md"), "# not a table row\n", "utf8");
      run(["add", "fff.record.md"]);
      expect(() => readReviewRecordRows(dir)).toThrow(/fff\.record\.md: no review record row found/);
    } finally {
      removePathSync(dir, { recursive: true });
    }
  });

  it("falls back to scanning the filesystem when git is unavailable", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "review-records-nogit-"));
    try {
      writeFileSync(path.join(dir, "ggg.record.md"), ROW_A.line + "\n", "utf8");
      const rows = readReviewRecordRows(dir);
      expect(rows).toHaveLength(1);
      expect(rows[0].line).toBe(ROW_A.line);
    } finally {
      removePathSync(dir, { recursive: true });
    }
  });
});

describe("the real review record corpus", () => {
  it("parses every committed record into six populated columns", async () => {
    // Real-data proof for the locally-owned splitter. A fixture-only test would
    // not have caught the escaped pipes that actually appear in the corpus.
    const { readReviewRecordRows, buildReviewStateSection: build } =
      await import("../scripts/generate-repo-awareness-snapshot");
    const rows = readReviewRecordRows();
    const section = build(rows);
    expect(rows.some((row) => row.file === "docs/branch-review-ledger.md")).toBe(true);
    expect(rows.some((row) => row.file.startsWith("docs/archive/branch-review-ledger-"))).toBe(true);
    expect(rows.some((row) => row.file.startsWith("docs/branch-review-records/"))).toBe(true);
    expect(section.records.length).toBeGreaterThan(2_500);
    expect(section.records.some((record) => record.ref === "claude/latency-findings-impl-s8g01v")).toBe(true);
    for (const record of section.records) {
      expect(record.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(record.ref.length).toBeGreaterThan(0);
      // Frozen pre-contract rows include descriptive placeholder heads. The
      // ledger guard permits those historical rows but enforces SHAs for new
      // immutable records, so this projection only promises a populated cell.
      expect(record.head.length).toBeGreaterThan(0);
      expect(record.checks).not.toMatch(/\\\|/);
      expect(record.scope.length).toBeGreaterThan(0);
      expect(record.outcome.length).toBeGreaterThan(0);
    }
  });
});

describe("generate", () => {
  it("assembles all four sections under the declared version", () => {
    const snapshot = generate();
    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(routesCounts(snapshot.routes).pages).toBeGreaterThan(0);
    expect(documentationCounts(snapshot.documentation).documents).toBeGreaterThan(0);
    expect(snapshot.review_state.records.length).toBeGreaterThan(2_500);
    expect(testHealthCounts(snapshot.test_health).quarantined).toBeGreaterThanOrEqual(0);
  });

  it("records the revision of the last commit that touched its own inputs", () => {
    const snapshot = generate();
    // v3: a DATE, and no sha. The regex is what proves the coarsening happened —
    // a full ISO instant would still parse as a date, so parsability alone could
    // not catch a generator that quietly stopped narrowing.
    expect(snapshot.captured_revision?.committed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(new Date(snapshot.captured_revision!.committed_at).getTime())).toBe(false);
  });

  const INPUT_COMMIT_DATE = "2026-01-02T10:00:00+00:00";
  const HEAD_COMMIT_DATE = "2026-03-04T10:00:00+00:00";

  it("dates the revision by its own inputs, not by HEAD", () => {
    // The shape assertion above (a parsable date) cannot distinguish
    // "git log -- REVISION_INPUTS" from a bare "git rev-parse HEAD" — both
    // produce an equally valid-looking date. This builds a throwaway repo where
    // the two diverge and proves readCapturedRevision picks the input-scoped
    // commit, never HEAD.
    //
    // v3 dropped the sha, which is what this test used to compare, so the two
    // commits are now dated DAYS APART with an explicit committer date. That is
    // not a weaker discriminator here, it is the same one: the assertion still
    // fails if the generator reads HEAD, because HEAD's date is the later one.
    const dir = mkdtempSync(path.join(os.tmpdir(), "repo-awareness-revision-"));
    try {
      const run = (args: string[], committerDate?: string) =>
        execFileSync("git", args, {
          cwd: dir,
          encoding: "utf8",
          env: committerDate
            ? { ...process.env, GIT_COMMITTER_DATE: committerDate, GIT_AUTHOR_DATE: committerDate }
            : process.env,
        }).trim();
      run(["init", "-b", "main"]);
      run(["config", "user.email", "test@example.com"]);
      run(["config", "user.name", "Test"]);
      run(["config", "commit.gpgsign", "false"]);

      // Commit 1 touches a docs markdown file, one of REVISION_INPUTS.
      mkdirSync(path.join(dir, "docs"), { recursive: true });
      writeFileSync(path.join(dir, "docs", "a.md"), "a\n", "utf8");
      run(["add", "docs/a.md"]);
      run(["commit", "-m", "touch an input path"], INPUT_COMMIT_DATE);
      const inputSha = run(["rev-parse", "HEAD"]);

      // Commit 2 touches a path outside every REVISION_INPUTS entry and becomes
      // HEAD, without being a real input to anything the snapshot emits.
      writeFileSync(path.join(dir, "unrelated.txt"), "b\n", "utf8");
      run(["add", "unrelated.txt"]);
      run(["commit", "-m", "touch an unrelated path"], HEAD_COMMIT_DATE);
      const headSha = run(["rev-parse", "HEAD"]);

      expect(headSha).not.toBe(inputSha);

      const revision = readCapturedRevision({ cwd: dir });
      expect(revision?.committed_at).toBe("2026-01-02");
      expect(revision?.committed_at).not.toBe("2026-03-04");
    } finally {
      removePathSync(dir, { recursive: true });
    }
  });

  it("keeps the committed revision when git is unavailable", () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "repo-awareness-no-git-"));
    try {
      mkdirSync(path.join(outside, "data"), { recursive: true });
      const fakeRevision = { committed_at: "2026-08-28" };
      writeFileSync(
        path.join(outside, "data", "repo-awareness-snapshot.json"),
        JSON.stringify({ captured_revision: fakeRevision }),
        "utf8",
      );
      const revision = readCapturedRevision({ cwd: outside, snapshotPath: "data/repo-awareness-snapshot.json" });
      expect(revision).toEqual(fakeRevision);
    } finally {
      removePathSync(outside, { recursive: true });
    }
  });

  it("records null when outside git and there is no committed snapshot to preserve from", () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "repo-awareness-no-git-"));
    try {
      expect(readCapturedRevision({ cwd: outside, snapshotPath: "missing.json" })).toBeNull();
    } finally {
      removePathSync(outside, { recursive: true });
    }
  });

  it("refuses a malformed committed revision instead of carrying it forward", () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "repo-awareness-no-git-"));
    try {
      const snap = path.join(outside, "snap.json");
      writeFileSync(snap, JSON.stringify({ captured_revision: { committed_at: 123 } }), "utf8");
      expect(readCommittedRevision(snap)).toBeNull();
    } finally {
      removePathSync(outside, { recursive: true });
    }
  });

  it("carries no field derived from the current time", () => {
    // Byte-determinism is what makes the staleness gate trustworthy. A
    // `generated_at` would change the file on every run and fail the gate on an
    // unchanged repository, which trains people to ignore it.
    const first = JSON.stringify(generate());
    const second = JSON.stringify(generate());
    expect(first).toBe(second);
    expect(first).not.toMatch(/generated_at/);
  });

  it("declares exactly the snapshot's known top-level keys, whatever a new time-derived field would be named", () => {
    // The `generated_at` grep above is name-specific: a field named
    // `built_at` or `captured_at` — or a second-resolution timestamp that
    // happens to match on both `generate()` calls above — would sail through
    // it undetected. Pinning the exact top-level key set catches any new
    // field regardless of what it is called, so it cannot rot the way a
    // literal-string grep can.
    const snapshot = generate();
    expect(Object.keys(snapshot).sort()).toEqual(
      ["version", "captured_revision", "routes", "documentation", "test_health", "review_state"].sort(),
    );
  });
});
